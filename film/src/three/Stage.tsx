import { useLayoutEffect, useMemo, type ReactNode } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/** Studio reflections (a PMREM-filtered room), black fog, and a camera placed by the shot. */
export function Stage({ cam, look = [0, 0, 0], fov = 32, fog = [6, 18], exposure = 1, envI = 0.55, children }: { cam: [number, number, number]; look?: [number, number, number]; fov?: number; fog?: [number, number]; exposure?: number; envI?: number; children: ReactNode }) {
  const { gl, scene } = useThree();
  const env = useMemo(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const tex = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    return tex;
  }, [gl]);
  // set synchronously: Remotion captures the frame right after this render
  scene.environment = env;
  scene.background = new THREE.Color("#060607");
  gl.toneMapping = THREE.ACESFilmicToneMapping;
  gl.outputColorSpace = THREE.SRGBColorSpace;
  gl.toneMappingExposure = exposure;
  scene.fog = new THREE.Fog("#060607", fog[0], fog[1]);
  // our own camera, made the default, so the shot (not the canvas) decides the lens
  const set = useThree((st) => st.set);
  const size = useThree((st) => st.size);
  const cam0 = useMemo(() => new THREE.PerspectiveCamera(fov, size.width / size.height, 0.05, 60), []);
  useLayoutEffect(() => { set({ camera: cam0 }); }, [cam0, set]);
  cam0.fov = fov;
  cam0.aspect = size.width / size.height;
  cam0.position.set(...cam);
  cam0.lookAt(...look);
  cam0.updateProjectionMatrix();
  scene.environmentIntensity = envI;
  return <>{children}</>;
}

/** A three-point setup: cool key, warm fill, and a coloured rim from behind. */
export function Lights({ rim = "#ffffff", key = 1, rimI = 2.5 }: { rim?: string; key?: number; rimI?: number }) {
  return (
    <>
      <ambientLight intensity={0.02} />
      <spotLight position={[-5, 6, 5]} angle={0.42} penumbra={0.8} intensity={110 * key} color="#e4ebff" decay={2} />
      <spotLight position={[6, -3, 4]} angle={0.5} penumbra={1} intensity={10 * key} color="#ffcf96" decay={2} />
      <pointLight position={[0, 3, -3]} intensity={rimI * 10} color={rim} distance={12} decay={2} />
    </>
  );
}

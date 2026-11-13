import { useMemo } from "react";
import * as THREE from "three";

/**
 * A procedural vault door, built for close-ups. Everything that moves is a prop driven by the
 * film's frame, so a render is deterministic:
 *   lit       how many of the 8 shield bolts glow (the vault's shields)
 *   bars      0 = locking bars thrown into the frame, 1 = fully retracted
 *   wheel     spoke-wheel rotation, radians
 *   open      0 = shut, 1 = swung open on its hinge
 *   flash     0..1, a shield block: the field lights and ripples
 *   glow      0..1, the gold light behind the door
 */
export interface VaultProps {
  tone: string; lit: number; bars?: number; wheel?: number; open?: number; flash?: number; glow?: number; t: number; field?: number; position?: [number, number, number]; scale?: number; fieldColor?: string;
}

const R = 1.6; // door radius

/** Circular brushing: fine streaks along the lathe's U (around the door), deterministic noise. */
function brushed(seed = 7) {
  const w = 1024, h = 128, c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d")!;
  let x = seed;
  const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647);
  g.fillStyle = "#8a8a8a"; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) {
    const y = rnd() * h, v = 100 + rnd() * 70;
    g.fillStyle = `rgba(${v},${v},${v},${0.18 + rnd() * 0.3})`;
    g.fillRect(rnd() * w, y, 40 + rnd() * 400, 0.6 + rnd() * 1.2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function lathe(points: [number, number][], segments = 96) {
  return new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), segments);
}

export function Vault({ tone, lit, bars = 0, wheel = 0, open = 0, flash = 0, glow = 0, t, field = 0.05, position = [0, 0, 0], scale = 1, fieldColor }: VaultProps) {
  const geo = useMemo(() => {
    // door: a thick disc with stepped bevels, lathed around Y then turned to face +Z
    const door = lathe([[0, 0.0], [R - 0.12, 0.0], [R, 0.06], [R, 0.3], [R - 0.08, 0.36], [1.32, 0.36], [1.27, 0.4], [1.0, 0.4], [0.96, 0.36], [0, 0.36]]);
    door.rotateX(Math.PI / 2);
    // frame: a deep beveled ring the door sits in
    const frame = lathe([[R + 0.02, -0.25], [R + 0.02, 0.32], [R + 0.12, 0.42], [R + 0.55, 0.42], [R + 0.62, 0.36], [R + 0.62, -0.25]]);
    frame.rotateX(Math.PI / 2);
    const tick = new THREE.BoxGeometry(0.012, 0.07, 0.01);
    return { door, frame, tick };
  }, []);

  const mats = useMemo(() => {
    const brush = brushed();
    return {
    steel: new THREE.MeshPhysicalMaterial({ color: "#5a5e68", metalness: 1, roughness: 0.42, roughnessMap: brush, bumpMap: brush, bumpScale: 0.6, clearcoat: 0.35, clearcoatRoughness: 0.2, side: THREE.DoubleSide }),
    frame: new THREE.MeshPhysicalMaterial({ color: "#2c2e34", metalness: 1, roughness: 0.55, roughnessMap: brush, side: THREE.DoubleSide }),
    chrome: new THREE.MeshPhysicalMaterial({ color: "#d9dbe2", metalness: 1, roughness: 0.16, clearcoat: 1 }),
    brass: new THREE.MeshPhysicalMaterial({ color: "#c9a24a", metalness: 1, roughness: 0.28 }),
    dark: new THREE.MeshStandardMaterial({ color: "#0b0b0d", metalness: 0.6, roughness: 0.7 }),
    gold: new THREE.MeshPhysicalMaterial({ color: "#e0b54a", metalness: 1, roughness: 0.2, emissive: new THREE.Color("#7a5200"), emissiveIntensity: 0.25 }),
    wall: new THREE.MeshStandardMaterial({ color: "#121215", metalness: 0.2, roughness: 0.92 }),
    collar: new THREE.MeshPhysicalMaterial({ color: "#1b1c20", metalness: 1, roughness: 0.6 }),
  };
  }, []);

  const toneCol = useMemo(() => new THREE.Color(tone), [tone]);
  const glowTex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d")!;
    const gr = g.createRadialGradient(128, 150, 6, 128, 128, 128);
    gr.addColorStop(0, "rgba(255,214,130,1)");
    gr.addColorStop(0.25, "rgba(230,150,40,0.75)");
    gr.addColorStop(0.6, "rgba(120,60,8,0.3)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  const hinge = -R - 0.05;
  const swing = -open * 1.75; // radians
  const barOut = 0.26 * (1 - bars); // how far each bar reaches into the frame

  return (
    <group position={position} scale={scale}>
      {/* the frame, a recessed collar, and the wall it is set in */}
      <mesh geometry={geo.frame} material={mats.frame} />
      <mesh position={[0, 0, -0.3]} material={mats.collar}>
        <ringGeometry args={[R + 0.6, R + 1.1, 96]} />
      </mesh>
      <mesh position={[0, 0, -0.32]} material={mats.wall}>
        <planeGeometry args={[30, 18]} />
      </mesh>
      {/* the vault's back wall: dark, with warm light falling off from the centre */}
      <mesh position={[0, 0, -0.27]}>
        <circleGeometry args={[R + 0.05, 96]} />
        <meshBasicMaterial color="#060504" />
      </mesh>
      <mesh position={[0, 0, -0.26]}>
        <circleGeometry args={[R + 0.05, 96]} />
        <meshBasicMaterial map={glowTex} transparent opacity={glow} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* the treasure behind the door, lit when it opens */}
      {glow > 0.01 && <GoldStack glow={glow} mat={mats.gold} />}
      {glow > 0.01 && <pointLight position={[0, 0, 0.2]} color="#ffb84a" intensity={glow * 9} distance={7} decay={1.6} />}

      {/* the door swings on a hinge at its left edge */}
      <group position={[hinge, 0, 0]} rotation={[0, swing, 0]}>
        <group position={[-hinge, 0, 0]}>
          <mesh geometry={geo.door} material={mats.steel} />
          {/* engraved rings */}
          {[1.2, 0.86].map((r) => (
            <mesh key={r} position={[0, 0, 0.405]}>
              <torusGeometry args={[r, 0.008, 8, 128]} />
              <meshStandardMaterial color="#0d0d10" emissive={toneCol} emissiveIntensity={0.18 + flash * 1.5} />
            </mesh>
          ))}
          {/* 16 rim bolts; the 8 even ones are the shields and glow when on */}
          {Array.from({ length: 16 }, (_, i) => {
            const a = (i / 16) * Math.PI * 2 + Math.PI / 2;
            const shield = i % 2 === 0 ? i / 2 : -1;
            const on = shield >= 0 && shield < lit;
            return (
              <mesh key={i} position={[Math.cos(a) * 1.46, Math.sin(a) * 1.46, 0.38]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[on ? 0.06 : 0.05, on ? 0.07 : 0.06, 0.06, 24]} />
                {on ? <meshStandardMaterial color="#160608" emissive={toneCol} emissiveIntensity={1.8 + flash * 3} metalness={0.2} roughness={0.4} /> : <primitive object={mats.chrome} attach="material" />}
              </mesh>
            );
          })}
          {/* locking bars: thrown out into the frame when locked */}
          {Array.from({ length: 6 }, (_, i) => {
            const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
            const r = R - 0.15 + barOut;
            return (
              <mesh key={i} position={[Math.cos(a) * r, Math.sin(a) * r, 0.18]} rotation={[0, 0, a]} material={mats.chrome}>
                <boxGeometry args={[0.42, 0.11, 0.11]} />
              </mesh>
            );
          })}
          {/* the dial: engraved ticks */}
          <group position={[0, 0, 0.41]} rotation={[0, 0, wheel * 0.35]}>
            {Array.from({ length: 60 }, (_, i) => {
              const a = (i / 60) * Math.PI * 2;
              return <mesh key={i} geometry={geo.tick} position={[Math.cos(a) * 0.62, Math.sin(a) * 0.62, 0]} rotation={[0, 0, a + Math.PI / 2]} material={i % 5 === 0 ? mats.brass : mats.chrome} scale={[1, i % 5 === 0 ? 1.6 : 1, 1]} />;
            })}
          </group>
          {/* the hub and the three-spoke wheel */}
          <mesh position={[0, 0, 0.47]} rotation={[Math.PI / 2, 0, 0]} material={mats.chrome}>
            <cylinderGeometry args={[0.24, 0.3, 0.16, 48]} />
          </mesh>
          <mesh position={[0, 0, 0.56]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.12, 0.12, 0.04, 48]} />
            <meshStandardMaterial color="#0b0b0d" emissive={toneCol} emissiveIntensity={0.6 + flash * 3} />
          </mesh>
          <group position={[0, 0, 0.52]} rotation={[0, 0, wheel]}>
            {[0, 1, 2].map((k) => (
              <group key={k} rotation={[0, 0, (k / 3) * Math.PI * 2]}>
                <mesh position={[0, 0.5, 0]} material={mats.chrome}>
                  <cylinderGeometry args={[0.035, 0.035, 0.84, 16]} />
                </mesh>
                <mesh position={[0, 0.94, 0]} material={mats.brass}>
                  <sphereGeometry args={[0.07, 24, 16]} />
                </mesh>
              </group>
            ))}
          </group>
          {/* the shield field: a custom shader in front of the door */}
          <ShieldField color={fieldColor ?? tone} strength={field + flash} t={t} ripple={flash} />
        </group>
      </group>
    </group>
  );
}

function GoldStack({ glow, mat }: { glow: number; mat: THREE.Material }) {
  const bars: [number, number, number][] = [];
  for (let row = 0; row < 3; row++) for (let i = -2; i <= 2 - row; i++) bars.push([i * 0.36 + row * 0.18, -1.05 + row * 0.16, -0.12 - (row % 2) * 0.02]);
  return (
    <group scale={1} position={[0, 0, 0]}>
      {bars.map((p, i) => (
        <mesh key={i} position={p} material={mat}>
          <boxGeometry args={[0.32, 0.14, 0.22]} />
        </mesh>
      ))}
      <mesh position={[0, 0, -0.24]}>
        <circleGeometry args={[R, 64]} />
        <meshBasicMaterial color="#ffcc66" transparent opacity={0.08 * glow} />
      </mesh>
    </group>
  );
}

/** A hexagonal energy lattice with a scanning band and a ripple on impact. Additive, so it only adds light. */
function ShieldField({ color, strength, t, ripple }: { color: string; strength: number; t: number; ripple: number }) {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: 0 }, uTime: { value: 0 }, uRipple: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uStrength; uniform float uTime; uniform float uRipple; varying vec2 vUv;
      float hex(vec2 p){ p = abs(p); return max(dot(p, normalize(vec2(1.0,1.732))), p.x); }
      void main(){
        vec2 p = (vUv - 0.5) * 2.0; float r = length(p); if (r > 1.0) discard;
        vec2 g = p * 9.0; vec2 a = mod(g, vec2(1.0,1.732)) - vec2(0.5,0.866); vec2 b = mod(g - vec2(0.5,0.866), vec2(1.0,1.732)) - vec2(0.5,0.866);
        vec2 h = dot(a,a) < dot(b,b) ? a : b; float edge = smoothstep(0.42, 0.5, hex(h));
        float rim = smoothstep(0.75, 1.0, r);
        float scan = smoothstep(0.08, 0.0, abs(fract(p.y * 0.5 + 0.5 - uTime * 0.25) - 0.5) - 0.42);
        float wave = uRipple * smoothstep(0.12, 0.0, abs(r - fract(uTime * 0.9) * 1.2)) ;
        float a2 = (edge * 0.35 + rim * 0.5 + scan * 0.25 + wave * 1.6) * uStrength * (1.0 - smoothstep(0.96, 1.0, r));
        gl_FragColor = vec4(uColor * a2, a2);
      }`,
  }), [color]);
  mat.uniforms.uStrength.value = Math.min(1.6, strength);
  mat.uniforms.uTime.value = t;
  mat.uniforms.uRipple.value = ripple;
  return (
    <mesh position={[0, 0, 0.7]} material={mat}>
      <planeGeometry args={[R * 2.25, R * 2.25]} />
    </mesh>
  );
}

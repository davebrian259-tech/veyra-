import { useMemo } from "react";
import * as THREE from "three";

/** A cast gold bar with an engraved top: the vault's loot item. */
export function Ingot({ vault = 4, rotation = [0, 0, 0], position = [0, 0, 0], scale = 1 }: { vault?: number; rotation?: [number, number, number]; position?: [number, number, number]; scale?: number }) {
  const { geo, mat, top } = useMemo(() => {
    // trapezoid cross-section, wider at the base, extruded along the bar's length
    const s = new THREE.Shape();
    s.moveTo(-0.55, 0); s.lineTo(0.55, 0); s.lineTo(0.42, 0.36); s.lineTo(-0.42, 0.36); s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth: 2.0, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.045, bevelSegments: 6, curveSegments: 4 });
    geo.translate(0, -0.18, -1.0);
    const mat = new THREE.MeshPhysicalMaterial({ color: "#e8b94a", metalness: 1, roughness: 0.18, clearcoat: 0.6, clearcoatRoughness: 0.12 });
    // the engraving: dark recessed letters on a gold field, used as colour + bump
    const c = document.createElement("canvas");
    c.width = 1024; c.height = 512;
    const g = c.getContext("2d")!;
    g.fillStyle = "#d6a83e"; g.fillRect(0, 0, 1024, 512);
    g.strokeStyle = "rgba(90,60,10,0.55)"; g.lineWidth = 6; g.strokeRect(40, 40, 944, 432);
    g.fillStyle = "rgba(80,52,8,0.85)";
    g.textAlign = "center";
    g.font = "600 92px 'Geist Variable', sans-serif"; g.fillText("VEYRA HEIST", 512, 200);
    g.font = "500 54px 'Geist Mono Variable', monospace"; g.fillText(`VAULT 0${vault} · BAR-${vault}`, 512, 300);
    g.font = "500 40px 'Geist Mono Variable', monospace"; g.fillText("NEP-245 · FINE GOLD", 512, 380);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const top = new THREE.MeshPhysicalMaterial({ map: tex, bumpMap: tex, bumpScale: -2.5, metalness: 1, roughness: 0.24, clearcoat: 0.5 });
    return { geo, mat, top };
  }, [vault]);
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh geometry={geo} material={mat} />
      <mesh position={[0, 0.231, 0]} rotation={[-Math.PI / 2, 0, Math.PI / 2]} material={top}>
        <planeGeometry args={[1.8, 0.78]} />
      </mesh>
    </group>
  );
}

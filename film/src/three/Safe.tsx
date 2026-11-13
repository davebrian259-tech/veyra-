import { useMemo } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/**
 * A freestanding vault for a white stage: a lacquered, reflective body in the vault's colour, a
 * chrome round door on a hinge, and gold inside. Each shield is its own visible layer, so the
 * escalation reads at a glance:
 *   caps     two rings that orbit the body        (Budget caps)
 *   cheque   a bright ring around the door        (Cheque self-check)
 *   payee    a cage of chrome bars that drops in  (Payee lock)
 *   price    a hexagonal glass dome               (Price seal)
 *   scanner  laser sheets sweeping the front      (Scanner)
 *   taint    red traces racing across the floor   (Taint trace)
 * Every value is 0..1 and comes from the frame, so renders are deterministic.
 */
export interface Layers { caps?: number; cheque?: number; payee?: number; price?: number; scanner?: number; taint?: number }
export interface SafeProps {
  tone: string; accent?: string; t: number; open?: number; wheel?: number; glow?: number; hit?: number; layers?: Layers;
  position?: [number, number, number]; rotY?: number; scale?: number; shadow?: number;
}

const W = 2.4, H = 2.6, D = 2.0, FLOOR = -H / 2;

function shadowTex() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  gr.addColorStop(0, "rgba(20,18,16,0.55)");
  gr.addColorStop(0.45, "rgba(20,18,16,0.22)");
  gr.addColorStop(1, "rgba(20,18,16,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let SHADOW: THREE.Texture | null = null;
let GLOW: THREE.Texture | null = null;
function glowTex() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(128, 170, 8, 128, 128, 128);
  gr.addColorStop(0, "rgba(255,226,150,1)");
  gr.addColorStop(0.35, "rgba(240,165,40,0.85)");
  gr.addColorStop(0.75, "rgba(120,60,6,0.35)");
  gr.addColorStop(1, "rgba(30,14,0,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function Safe({ tone, accent, t, open = 0, wheel = 0, glow = 0, hit = 0, layers = {}, position = [0, 0, 0], rotY = 0, scale = 1, shadow = 1 }: SafeProps) {
  const geo = useMemo(() => ({ body: new RoundedBoxGeometry(W, H, D, 8, 0.2), foot: new RoundedBoxGeometry(0.34, 0.16, 0.34, 3, 0.04) }), []);
  const mats = useMemo(() => {
    const col = new THREE.Color(tone);
    return {
      body: new THREE.MeshPhysicalMaterial({ color: col.clone(), metalness: 0.1, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 0.7 }),
      trim: new THREE.MeshPhysicalMaterial({ color: col.clone().multiplyScalar(0.55), metalness: 0.8, roughness: 0.3, clearcoat: 0.6 }),
      chrome: new THREE.MeshPhysicalMaterial({ color: "#eceef2", metalness: 1, roughness: 0.08, clearcoat: 1 }),
      steel: new THREE.MeshPhysicalMaterial({ color: "#b9bcc4", metalness: 1, roughness: 0.22, clearcoat: 0.5 }),
      inner: new THREE.MeshStandardMaterial({ color: "#16130f", roughness: 0.9 }),
      gold: new THREE.MeshPhysicalMaterial({ color: "#f2c14e", metalness: 1, roughness: 0.16, emissive: new THREE.Color("#a86d00"), emissiveIntensity: 0.35 }),
      glowing: new THREE.MeshStandardMaterial({ color: accent ?? col, emissive: accent ?? col, emissiveIntensity: 1.4, roughness: 0.3 }),
    };
  }, [tone, accent]);
  SHADOW ??= shadowTex();
  GLOW ??= glowTex();
  const L = { caps: 0, cheque: 0, payee: 0, price: 0, scanner: 0, taint: 0, ...layers };
  const hingeX = -0.98;
  const swing = -open * 1.9;
  const z = D / 2;

  return (
    <group position={position} rotation={[0, rotY, 0]} scale={scale}>
      {/* contact shadow on the floor */}
      <mesh position={[0, FLOOR - 0.159, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
        <planeGeometry args={[W * 2.6, D * 2.8]} />
        <meshBasicMaterial map={SHADOW} transparent opacity={shadow} depthWrite={false} toneMapped={false} />
      </mesh>
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, zz], i) => (
        <mesh key={i} geometry={geo.foot} material={mats.chrome} position={[x * (W / 2 - 0.3), FLOOR - 0.06, zz * (D / 2 - 0.3)]} />
      ))}
      <mesh geometry={geo.body} material={mats.body} />
      {/* the door's recess and the treasure behind it */}
      <mesh position={[0, 0.05, z + 0.001]} material={mats.trim}>
        <ringGeometry args={[1.0, 1.12, 96]} />
      </mesh>
      {open > 0.01 && (
        <group position={[0, 0.05, z + 0.004]}>
          <mesh material={mats.inner}><circleGeometry args={[1.0, 96]} /></mesh>
          <mesh position={[0, 0, 0.002]}><circleGeometry args={[0.98, 64]} /><meshBasicMaterial map={GLOW} transparent opacity={glow} toneMapped={false} depthWrite={false} /></mesh>
          {[[-0.36, -0.6], [0, -0.6], [0.36, -0.6], [-0.18, -0.44], [0.18, -0.44], [0, -0.28]].map(([x, y], i) => (
            <mesh key={i} position={[x, y, 0.08]} material={mats.gold}><boxGeometry args={[0.32, 0.15, 0.14]} /></mesh>
          ))}
          <pointLight position={[0, 0, 1.2]} color="#ffbf4a" intensity={glow * 10} distance={6} decay={1.6} />
        </group>
      )}
      {/* the door, hinged at its left edge */}
      <group position={[hingeX, 0.05, z + 0.02]} rotation={[0, swing, 0]}>
        <group position={[-hingeX, 0, 0]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.06]} material={mats.steel}>
            <cylinderGeometry args={[0.99, 0.99, 0.14, 96]} />
          </mesh>
          <mesh position={[0, 0, 0.135]} material={mats.chrome}><ringGeometry args={[0.72, 0.8, 96]} /></mesh>
          {/* eight bolts around the door: one per shield, lit in the vault's colour */}
          {Array.from({ length: 8 }, (_, i) => {
            const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
            return (
              <mesh key={i} position={[Math.cos(a) * 0.88, Math.sin(a) * 0.88, 0.15]} rotation={[Math.PI / 2, 0, 0]} material={mats.glowing}>
                <cylinderGeometry args={[0.045, 0.045, 0.04, 20]} />
              </mesh>
            );
          })}
          {/* the wheel */}
          <group position={[0, 0, 0.22]} rotation={[0, 0, wheel]}>
            <mesh material={mats.chrome}><torusGeometry args={[0.46, 0.035, 16, 72]} /></mesh>
            {[0, 1, 2].map((k) => (
              <mesh key={k} rotation={[0, 0, (k / 3) * Math.PI * 2]} position={[0, 0, 0]} material={mats.chrome}>
                <boxGeometry args={[0.05, 0.92, 0.05]} />
              </mesh>
            ))}
            <mesh rotation={[Math.PI / 2, 0, 0]} material={mats.trim}><cylinderGeometry args={[0.13, 0.13, 0.08, 40]} /></mesh>
          </group>
        </group>
      </group>
      <Shields L={L} t={t} tone={tone} hit={hit} z={z} />
    </group>
  );
}

function Shields({ L, t, tone, hit, z }: { L: Required<Layers>; t: number; tone: string; hit: number; z: number }) {
  const col = useMemo(() => new THREE.Color(tone), [tone]);
  const glowMat = useMemo(() => new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.6, roughness: 0.2, transparent: true }), [col]);
  const red = useMemo(() => new THREE.MeshStandardMaterial({ color: "#ff1f3d", emissive: "#ff1f3d", emissiveIntensity: 2.2, transparent: true }), []);
  const laser = useMemo(() => new THREE.MeshBasicMaterial({ color: "#ff2a55", transparent: true, toneMapped: false, side: THREE.DoubleSide }), []);
  const chrome = useMemo(() => new THREE.MeshPhysicalMaterial({ color: "#f1f2f5", metalness: 1, roughness: 0.06, clearcoat: 1 }), []);
  const dome = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(tone) }, uA: { value: 0 }, uT: { value: 0 }, uHit: { value: 0 } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv=uv; vN=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.0); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uA; uniform float uT; uniform float uHit; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      float hex(vec2 p){ p=abs(p); return max(dot(p,normalize(vec2(1.0,1.732))),p.x); }
      void main(){
        vec2 g=vec2(vUv.x*42.0, vUv.y*16.0); vec2 a=mod(g,vec2(1.0,1.732))-vec2(0.5,0.866); vec2 b=mod(g-vec2(0.5,0.866),vec2(1.0,1.732))-vec2(0.5,0.866);
        vec2 h=dot(a,a)<dot(b,b)?a:b; float edge=smoothstep(0.40,0.48,hex(h));
        float fres=pow(1.0-abs(dot(vN,vV)),2.0);
        float build=1.0-smoothstep(uA*1.1-0.1, uA*1.1, vUv.y);
        float wave=uHit*smoothstep(0.06,0.0,abs(fract(vUv.y*1.0+uT*1.2)-0.5)-0.38);
        float al=(edge*0.75+fres*0.55+wave)*build*uA;
        gl_FragColor=vec4(uColor*(0.75+wave), clamp(al,0.0,0.9));
      }`,
  }), [tone]);
  dome.uniforms.uA.value = L.price;
  dome.uniforms.uT.value = t;
  dome.uniforms.uHit.value = hit;
  glowMat.emissiveIntensity = 1.4 + hit * 3;
  glowMat.opacity = Math.min(1, L.caps * 1.5);
  return (
    <group>
      {/* Budget caps: two rings orbiting the body */}
      {L.caps > 0.01 && [-0.75, 0.85].map((y, i) => (
        <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2 + Math.sin(t * 0.8 + i) * 0.06, 0, t * (i ? -0.5 : 0.5)]} scale={0.6 + 0.4 * L.caps} material={glowMat}>
          <torusGeometry args={[1.95, 0.022, 10, 160]} />
        </mesh>
      ))}
      {/* Cheque self-check: a ring that turns around the door */}
      {L.cheque > 0.01 && (
        <group position={[0, 0.05, z + 0.32]} rotation={[0, 0, -t * 1.2]} scale={0.8 + 0.2 * L.cheque}>
          {Array.from({ length: 24 }, (_, i) => {
            const a = (i / 24) * Math.PI * 2;
            return <mesh key={i} position={[Math.cos(a) * 1.22, Math.sin(a) * 1.22, 0]} rotation={[0, 0, a]} material={glowMat} scale={[1, L.cheque, 1]}><boxGeometry args={[0.035, 0.14, 0.02]} /></mesh>;
          })}
        </group>
      )}
      {/* Payee lock: a cage of chrome bars drops around the vault */}
      {L.payee > 0.01 && (
        <group position={[0, (1 - L.payee) * 7, 0]}>
          {Array.from({ length: 20 }, (_, i) => {
            const a = (i / 20) * Math.PI * 2;
            return <mesh key={i} position={[Math.cos(a) * 2.25, 0, Math.sin(a) * 2.25]} material={chrome}><cylinderGeometry args={[0.035, 0.035, 3.3, 14]} /></mesh>;
          })}
          {[-1.62, 1.62].map((y) => <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]} material={chrome}><torusGeometry args={[2.25, 0.06, 12, 120]} /></mesh>)}
          <mesh position={[0, 1.62, 0]} rotation={[Math.PI / 2, 0, 0]} material={glowMat}><torusGeometry args={[2.25, 0.02, 8, 120]} /></mesh>
        </group>
      )}
      {/* Price seal: a hexagonal glass dome */}
      {L.price > 0.01 && (
        <mesh position={[0, -1.3, 0]} material={dome} renderOrder={5}>
          <sphereGeometry args={[2.85, 96, 48, 0, Math.PI * 2, 0, Math.PI / 2]} />
        </mesh>
      )}
      {/* Scanner: two laser sheets sweep the front of the vault */}
      {L.scanner > 0.01 && [0, 1].map((k) => {
        const y = Math.sin(t * 2.2 + k * Math.PI) * 1.25;
        return (
          <group key={k} position={[0, y, z + 0.9]}>
            <mesh material={laser} scale={[L.scanner, 1, 1]}><boxGeometry args={[4.6, 0.025, 0.025]} /></mesh>
            <mesh material={laser} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -0.45]} scale={[L.scanner, 1, 1]}>
              <planeGeometry args={[4.6, 0.9]} />
              <meshBasicMaterial color="#ff2a55" transparent opacity={0.12 * L.scanner} toneMapped={false} side={THREE.DoubleSide} depthWrite={false} />
            </mesh>
          </group>
        );
      })}
      {/* Taint trace: red lines race across the floor and a pulse rings the vault */}
      {L.taint > 0.01 && (
        <group position={[0, -1.43, 0]}>
          {Array.from({ length: 9 }, (_, i) => {
            const a = (i - 4) * 0.2; // fanning out toward the camera
            const len = 7 * L.taint;
            return (
              <group key={i} rotation={[0, a - Math.PI / 2, 0]}>
                <mesh position={[2.3 + len / 2, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} material={red}><planeGeometry args={[len, 0.05]} /></mesh>
              </group>
            );
          })}
          <mesh rotation={[-Math.PI / 2, 0, 0]} material={red} scale={1 + ((t * 0.8) % 1) * 0.6}>
            <ringGeometry args={[2.3, 2.36, 120]} />
          </mesh>
        </group>
      )}
    </group>
  );
}

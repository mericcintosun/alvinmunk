'use client';

/**
 * Shared 3D constellation primitives (R3F / three.js) used by the app hero
 * (constellation-3d) and the marketing backdrop (constellation-backdrop): the glow
 * sprite texture, a sphere-distribution helper, a glowing Star, and a live OrbitRing.
 * Additive-blended glow, no postprocessing dependency.
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/** A soft radial-gradient sprite texture for additive glow (built once on the client). */
export function makeGlowTexture(): THREE.Texture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

/** Evenly distribute n points on a sphere (fibonacci) so stars never overlap. */
export function fibonacciSphere(n: number, radius: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = phi * i;
    pts.push(new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r).multiplyScalar(radius));
  }
  return pts;
}

/** A glowing point: additive halo sprite + a small bright core. */
export function Star({
  glow,
  color,
  coreSize,
  glowScale,
  hovered = false,
  opacity = 0.7,
  onOver,
  onOut,
  onClick,
}: {
  glow: THREE.Texture;
  color: THREE.Color | string;
  coreSize: number;
  glowScale: number;
  hovered?: boolean;
  opacity?: number;
  onOver?: () => void;
  onOut?: () => void;
  onClick?: () => void;
}) {
  const sprite = useRef<THREE.Sprite>(null);
  const phase = useRef(Math.random() * Math.PI * 2);
  useFrame((_, d) => {
    phase.current += d;
    const pulse = 1 + Math.sin(phase.current * 1.5) * 0.07;
    sprite.current?.scale.setScalar(glowScale * (hovered ? 1.7 : 1) * pulse);
  });
  return (
    <group>
      <sprite ref={sprite}>
        <spriteMaterial
          map={glow}
          color={color}
          transparent
          opacity={hovered ? 0.98 : opacity}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </sprite>
      <mesh onPointerOver={onOver} onPointerOut={onOut} onClick={onClick}>
        <sphereGeometry args={[coreSize * (hovered ? 1.35 : 1), 20, 20]} />
        <meshBasicMaterial color={hovered ? '#ffffff' : color} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** A thin glowing orbital ring with a particle riding it — always-on cosmic motion. */
export function OrbitRing({
  radius,
  rotation,
  speed,
  color,
  glow,
  reduced,
}: {
  radius: number;
  rotation: [number, number, number];
  speed: number;
  color: string;
  glow: THREE.Texture;
  reduced: boolean;
}) {
  const dot = useRef<THREE.Group>(null);
  const a = useRef(Math.random() * Math.PI * 2);
  useFrame((_, d) => {
    if (!reduced) a.current += d * speed;
    dot.current?.position.set(Math.cos(a.current) * radius, Math.sin(a.current) * radius, 0);
  });
  return (
    <group rotation={rotation}>
      <mesh>
        <torusGeometry args={[radius, 0.006, 8, 128]} />
        <meshBasicMaterial color={color} transparent opacity={0.22} toneMapped={false} />
      </mesh>
      <group ref={dot}>
        <sprite scale={0.5}>
          <spriteMaterial
            map={glow}
            color={color}
            transparent
            opacity={0.95}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </sprite>
      </group>
    </group>
  );
}

/** Shared hook: the once-built glow texture. */
export function useGlow(): THREE.Texture {
  return useMemo(makeGlowTexture, []);
}

export function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

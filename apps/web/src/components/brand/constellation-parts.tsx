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

/**
 * A solid five-point star sprite texture (filled classic star + a soft glow halo),
 * built once on the client. Kept pure white so each instance tints it via its own
 * palette color.
 */
export function makeGlowTexture(): THREE.Texture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  const mid = s / 2;
  ctx.translate(mid, mid);

  // Soft halo behind the star so it blooms instead of sitting hard against space.
  const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, mid);
  halo.addColorStop(0, 'rgba(255,255,255,0.55)');
  halo.addColorStop(0.45, 'rgba(255,255,255,0.12)');
  halo.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(-mid, -mid, s, s);

  // Filled classic 5-point star. Inner/outer ratio 0.382 gives the sharp, even shape.
  const R = mid * 0.86;
  const r = R * 0.382;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? R : r;
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = Math.cos(ang) * rad;
    const y = Math.sin(ang) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  // Brightest at the core, easing out toward the points for a little depth.
  const fill = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
  fill.addColorStop(0, 'rgba(255,255,255,1)');
  fill.addColorStop(1, 'rgba(255,255,255,0.82)');
  ctx.fillStyle = fill;
  ctx.fill();

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

/** Global size multiplier for every star sprite — tune the whole sky in one place. */
const STAR_SCALE = 0.6;

/** A glowing five-point star sprite (no solid core dot; the sprite is the star). */
export function Star({
  glow,
  color,
  coreSize,
  glowScale,
  hovered = false,
  opacity = 0.7,
  reduced = false,
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
  reduced?: boolean;
  onOver?: () => void;
  onOut?: () => void;
  onClick?: () => void;
}) {
  const sprite = useRef<THREE.Sprite>(null);
  const phase = useRef(Math.random() * Math.PI * 2);
  useFrame((_, d) => {
    // Honor prefers-reduced-motion fully: no idle pulse, only the static (and hover) scale.
    const pulse = reduced ? 1 : 1 + Math.sin((phase.current += d) * 1.5) * 0.07;
    sprite.current?.scale.setScalar(glowScale * STAR_SCALE * (hovered ? 1.7 : 1) * pulse);
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
      {/* Invisible hit target — keeps hover/click raycasting without drawing a round
          core dot on top of the star sprite. */}
      <mesh onPointerOver={onOver} onPointerOut={onOut} onClick={onClick}>
        <sphereGeometry args={[coreSize * (hovered ? 1.35 : 1), 12, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
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

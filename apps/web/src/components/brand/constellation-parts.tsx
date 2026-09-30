'use client';

/**
 * Shared 3D constellation primitives (R3F / three.js) used by the app hero
 * (constellation-3d) and the marketing backdrop (constellation-backdrop): the glow
 * sprite texture, a sphere-distribution helper, a glowing Star, and a live OrbitRing.
 * Additive-blended glow on the dark sky, normal blending on the light one (an additive
 * halo washes out to white there); no postprocessing dependency.
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

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

/** Additive glow adds light, which only reads on a dark sky; the light theme paints over it. */
export function glowBlending(light: boolean): THREE.Blending {
  return light ? THREE.NormalBlending : THREE.AdditiveBlending;
}

/** A glowing five-point star sprite (no solid core dot; the sprite is the star). */
export function Star({
  glow,
  color,
  coreSize,
  glowScale,
  hovered = false,
  opacity = 0.7,
  reduced = false,
  light = false,
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
  light?: boolean;
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
          blending={glowBlending(light)}
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
  light = false,
}: {
  radius: number;
  rotation: [number, number, number];
  speed: number;
  color: string;
  glow: THREE.Texture;
  reduced: boolean;
  light?: boolean;
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
        <meshBasicMaterial color={color} transparent opacity={light ? 0.4 : 0.22} toneMapped={false} />
      </mesh>
      <group ref={dot}>
        <sprite scale={0.5}>
          <spriteMaterial
            map={glow}
            color={color}
            transparent
            opacity={0.95}
            blending={glowBlending(light)}
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

/**
 * Live `prefers-reduced-motion`. Unlike a one-shot read at mount, this subscribes to the
 * media query, so flipping the OS setting takes effect without a reload. Shared by every
 * constellation scene (app hero + marketing backdrop) so they all honor it the same way.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(REDUCED_MOTION_QUERY).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(REDUCED_MOTION_QUERY);
    setReduced(media.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

/**
 * Shared offscreen-pausing logic for both constellation canvases: observes `containerRef`
 * with an `IntersectionObserver` and also tracks tab visibility (`document.hidden`), so a
 * canvas stops issuing WebGL frames both when scrolled out of view AND when the tab is
 * backgrounded. Reduced-motion users get `'demand'` (render once, then only on explicit
 * `invalidate()` calls) instead of the visibility-driven `'always'`/`'never'` toggle, since
 * their scenes are meant to stay static regardless of scroll position.
 *
 * SSR-safe: `IntersectionObserver`/`document` are only touched inside effects, which never
 * run during server rendering, and the effect itself no-ops when `IntersectionObserver` is
 * unavailable (leaving the canvas rendering normally rather than freezing it forever).
 */
export function useFrameloop(
  containerRef: RefObject<HTMLElement | null>,
  reduced: boolean,
): 'always' | 'demand' | 'never' {
  const [intersecting, setIntersecting] = useState(true);
  const [tabVisible, setTabVisible] = useState(
    () => typeof document === 'undefined' || !document.hidden,
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => setIntersecting(entry.isIntersecting),
      { rootMargin: '100px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [containerRef]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisibilityChange = () => setTabVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  if (reduced) return 'demand';
  return intersecting && tabVisible ? 'always' : 'never';
}

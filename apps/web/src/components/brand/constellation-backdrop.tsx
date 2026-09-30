'use client';

/**
 * Marketing constellation backdrop — a generative 3D star network behind the landing
 * hero (decorative, no data, no interaction). Same visual language as the app hero so
 * the product and the pitch feel like one world. Client-only via dynamic(ssr:false).
 */
import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Stars, Line } from '@react-three/drei';
import * as THREE from 'three';
import {
  Star,
  OrbitRing,
  useGlow,
  fibonacciSphere,
  useFrameloop,
  usePrefersReducedMotion,
} from './constellation-parts';
import { brandPalette } from '@/lib/brand-palette';
import { useLightTheme } from '@/lib/use-light-theme';

const HUES = [265, 157, 193, 280, 200, 157, 265, 40, 193, 270, 157, 265];

function Scene({ reduced, light }: { reduced: boolean; light: boolean }) {
  const skyTilt = useRef<THREE.Group>(null);
  const shift = useRef<THREE.Group>(null);
  const tilt = useRef<THREE.Group>(null);
  const spin = useRef<THREE.Group>(null);
  const glow = useGlow();
  const palette = brandPalette(light);
  const target = useRef({ x: 0, y: 0 });
  const { viewport, size } = useThree();

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      target.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      target.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  const positions = useMemo(() => fibonacciSphere(12, 3.2), []);
  // The light sky needs darker tones of the same hues to show.
  const colors = useMemo(
    () => HUES.map((h) => new THREE.Color().setHSL(h / 360, 0.7, light ? 0.45 : 0.66)),
    [light],
  );

  useFrame((_, d) => {
    // Push the constellation focal point to the right half on wide screens; keep it
    // centered on narrow/stacked layouts. Lerp so resizes glide instead of snapping.
    const off = size.width >= 768 ? viewport.width * 0.2 : 0;
    if (shift.current) {
      // Layout, not motion: under reduced motion jump straight to it (no glide).
      shift.current.position.x = reduced
        ? off
        : shift.current.position.x + (off - shift.current.position.x) * 0.08;
    }
    // prefers-reduced-motion: freeze spin AND cursor parallax. A full-bleed parallax
    // field behind the hero is exactly the vestibular trigger the setting is for.
    if (reduced) return;
    if (spin.current) spin.current.rotation.y += d * 0.06;
    const tx = -target.current.y * 0.26;
    const ty = target.current.x * 0.38;
    if (tilt.current) {
      tilt.current.rotation.x += (tx - tilt.current.rotation.x) * 0.05;
      tilt.current.rotation.y += (ty - tilt.current.rotation.y) * 0.05;
    }
    if (skyTilt.current) {
      skyTilt.current.rotation.x += (tx * 0.4 - skyTilt.current.rotation.x) * 0.03;
      skyTilt.current.rotation.y += (ty * 0.4 - skyTilt.current.rotation.y) * 0.03;
    }
  });

  return (
    <>
      <group ref={skyTilt}>
        {/* Near-white additive points vanish on the light theme; the page starfield covers it. */}
        {!light && (
          <Stars radius={75} depth={55} count={3000} factor={4.2} saturation={0} fade speed={reduced ? 0 : 0.5} />
        )}
      </group>
      <group ref={shift}>
      <group ref={tilt}>
        <OrbitRing radius={1.7} rotation={[1.2, 0.3, 0]} speed={0.42} color={palette.violet} glow={glow} reduced={reduced} light={light} />
        <OrbitRing radius={2.5} rotation={[0.5, 1.1, 0.4]} speed={-0.3} color={palette.green} glow={glow} reduced={reduced} light={light} />
        <OrbitRing radius={3.1} rotation={[1.7, 0.8, 0.9]} speed={0.18} color={palette.cyan} glow={glow} reduced={reduced} light={light} />
        <group ref={spin}>
          {positions.map((p, i) => (
            <Line
              key={`l-${i}`}
              points={[[0, 0, 0], [p.x, p.y, p.z]]}
              color={palette.muted}
              lineWidth={0.6}
              transparent
              opacity={0.16}
            />
          ))}
          {/* The "you" star: the gold accent, the same as the app hero. */}
          <Star
            glow={glow}
            color={palette.gold}
            coreSize={0.3}
            glowScale={3}
            opacity={0.9}
            reduced={reduced}
            light={light}
          />
          {positions.map((p, i) => (
            <group key={i} position={p}>
              <Star
                glow={glow}
                color={colors[i % colors.length]}
                coreSize={0.1}
                glowScale={0.74}
                opacity={0.85}
                reduced={reduced}
                light={light}
              />
            </group>
          ))}
        </group>
      </group>
      </group>
    </>
  );
}

export default function ConstellationBackdrop() {
  const reduced = usePrefersReducedMotion();
  const light = useLightTheme();
  const wrapRef = useRef<HTMLDivElement>(null);
  const frameloop = useFrameloop(wrapRef, reduced);
  return (
    <div ref={wrapRef} style={{ width: '100%', height: '100%' }}>
      <Canvas
        camera={{ position: [0, 0, 8.4], fov: 52 }}
        dpr={[1, 1.5]}
        gl={{ alpha: true, antialias: true }}
        style={{ background: 'transparent' }}
        frameloop={frameloop}
      >
        <Scene reduced={reduced} light={light} />
      </Canvas>
    </div>
  );
}

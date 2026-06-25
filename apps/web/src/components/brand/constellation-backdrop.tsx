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
import { Star, OrbitRing, useGlow, fibonacciSphere, reducedMotion } from './constellation-parts';

const HUES = [265, 157, 193, 280, 200, 157, 265, 40, 193, 270, 157, 265];

function Scene({ reduced }: { reduced: boolean }) {
  const skyTilt = useRef<THREE.Group>(null);
  const shift = useRef<THREE.Group>(null);
  const tilt = useRef<THREE.Group>(null);
  const spin = useRef<THREE.Group>(null);
  const glow = useGlow();
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
  const colors = useMemo(
    () => HUES.map((h) => new THREE.Color().setHSL(h / 360, 0.7, 0.66)),
    [],
  );
  const centerColor = useMemo(() => new THREE.Color().setHSL(24 / 360, 1, 0.66), []);

  useFrame((_, d) => {
    if (spin.current && !reduced) spin.current.rotation.y += d * 0.06;
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
    // Push the constellation focal point to the right half on wide screens; keep it
    // centered on narrow/stacked layouts. Lerp so resizes glide instead of snapping.
    if (shift.current) {
      const off = size.width >= 768 ? viewport.width * 0.2 : 0;
      shift.current.position.x += (off - shift.current.position.x) * 0.08;
    }
  });

  return (
    <>
      <group ref={skyTilt}>
        <Stars radius={75} depth={55} count={3000} factor={4.2} saturation={0} fade speed={reduced ? 0 : 0.5} />
      </group>
      <group ref={shift}>
      <group ref={tilt}>
        <OrbitRing radius={1.7} rotation={[1.2, 0.3, 0]} speed={0.42} color="#9945FF" glow={glow} reduced={reduced} />
        <OrbitRing radius={2.5} rotation={[0.5, 1.1, 0.4]} speed={-0.3} color="#14F195" glow={glow} reduced={reduced} />
        <OrbitRing radius={3.1} rotation={[1.7, 0.8, 0.9]} speed={0.18} color="#00D1FF" glow={glow} reduced={reduced} />
        <group ref={spin}>
          {positions.map((p, i) => (
            <Line
              key={`l-${i}`}
              points={[[0, 0, 0], [p.x, p.y, p.z]]}
              color="#a9b6e0"
              lineWidth={0.6}
              transparent
              opacity={0.16}
            />
          ))}
          <Star glow={glow} color={centerColor} coreSize={0.3} glowScale={3} opacity={0.9} />
          {positions.map((p, i) => (
            <group key={i} position={p}>
              <Star glow={glow} color={colors[i % colors.length]} coreSize={0.1} glowScale={0.74} opacity={0.85} />
            </group>
          ))}
        </group>
      </group>
      </group>
    </>
  );
}

export default function ConstellationBackdrop() {
  const reduced = reducedMotion();
  return (
    <Canvas
      camera={{ position: [0, 0, 8.4], fov: 52 }}
      dpr={[1, 2]}
      gl={{ alpha: true, antialias: true }}
      style={{ background: 'transparent' }}
    >
      <Scene reduced={reduced} />
    </Canvas>
  );
}

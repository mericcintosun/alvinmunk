'use client';

/**
 * The 3D constellation hero (R3F / three.js). Your star burns at the center; everyone
 * who vouched you orbits as a star, beamed to you. Hover lights a star up with a
 * tooltip; tap pins who/note/when. Alive even with an empty sky (orbital rings +
 * drifting particles + a parallaxing starfield react to the cursor). Loaded client-only
 * via dynamic(ssr:false). Shared 3D bits live in constellation-parts.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Stars, Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import { shortAddr } from '@alvinmunk/shared';
import {
  fetchVouchersOf,
  getPeopleCounts,
  timeAgo,
  addrHue,
  type VoucherStar,
} from '@/lib/constellation';
import {
  Star,
  OrbitRing,
  useGlow,
  fibonacciSphere,
  useFrameloop,
  usePrefersReducedMotion,
} from './constellation-parts';
import { useLocale, useTranslations } from '@/lib/i18n';
import { brandPalette } from '@/lib/brand-palette';
import { useLightTheme } from '@/lib/use-light-theme';
import { HERO_BOX } from './hero-box';

const RADIUS = 3.0;

function Scene({
  vouchers,
  reduced,
  light,
  onSelect,
  hoverId,
  setHoverId,
  locale,
}: {
  vouchers: VoucherStar[];
  reduced: boolean;
  light: boolean;
  onSelect: (v: VoucherStar | null) => void;
  hoverId: number | null;
  setHoverId: (id: number | null) => void;
  locale: string;
}) {
  const skyTilt = useRef<THREE.Group>(null);
  const tilt = useRef<THREE.Group>(null);
  const spin = useRef<THREE.Group>(null);
  const glow = useGlow();
  const palette = brandPalette(light);
  const target = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      target.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      target.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  const empty = vouchers.length === 0;
  const positions = useMemo(
    () => fibonacciSphere(empty ? 6 : vouchers.length, RADIUS),
    [empty, vouchers.length],
  );
  // Each voucher keeps its address hue; the light sky needs a darker tone of it to show.
  const colors = useMemo(
    () => vouchers.map((v) => new THREE.Color().setHSL(addrHue(v.from) / 360, 0.72, light ? 0.45 : 0.66)),
    [vouchers, light],
  );

  useFrame((_, d) => {
    if (reduced) return; // prefers-reduced-motion: freeze spin AND cursor parallax
    if (spin.current) spin.current.rotation.y += d * 0.08;
    const tx = -target.current.y * 0.3;
    const ty = target.current.x * 0.42;
    if (tilt.current) {
      tilt.current.rotation.x += (tx - tilt.current.rotation.x) * 0.06;
      tilt.current.rotation.y += (ty - tilt.current.rotation.y) * 0.06;
    }
    if (skyTilt.current) {
      skyTilt.current.rotation.x += (tx * 0.4 - skyTilt.current.rotation.x) * 0.04;
      skyTilt.current.rotation.y += (ty * 0.4 - skyTilt.current.rotation.y) * 0.04;
    }
  });

  return (
    <>
      <group ref={skyTilt}>
        {/* The distant sky is near-white additive points: invisible on the light theme, where
            the page starfield (dark stars) stands in for it. */}
        {!light && (
          <Stars radius={70} depth={50} count={2600} factor={4} saturation={0} fade speed={reduced ? 0 : 0.5} />
        )}
      </group>

      <group ref={tilt}>
        <OrbitRing radius={1.55} rotation={[1.2, 0.3, 0]} speed={0.5} color={palette.violet} glow={glow} reduced={reduced} light={light} />
        <OrbitRing radius={2.15} rotation={[0.5, 1.1, 0.4]} speed={-0.34} color={palette.green} glow={glow} reduced={reduced} light={light} />
        <OrbitRing radius={2.7} rotation={[1.7, 0.8, 0.9]} speed={0.22} color={palette.cyan} glow={glow} reduced={reduced} light={light} />

        <group ref={spin}>
          {!empty &&
            positions.map((p, i) => {
              const on = hoverId === vouchers[i].vouchId;
              return (
                <Line
                  key={`l-${vouchers[i].vouchId}`}
                  points={[[0, 0, 0], [p.x, p.y, p.z]]}
                  color={on ? palette.starlight : palette.muted}
                  lineWidth={on ? 1.5 : 0.7}
                  transparent
                  opacity={on ? 0.75 : 0.2}
                />
              );
            })}

          {/* Your star: the gold accent, the same "you" as the landing backdrop. */}
          <Star glow={glow} color={palette.gold} coreSize={0.26} glowScale={2.6} opacity={0.85} reduced={reduced} light={light} />

          {empty
            ? positions.map((p, i) => (
                <group key={`ghost-${i}`} position={p}>
                  <Star glow={glow} color={palette.muted} coreSize={0.055} glowScale={0.4} opacity={0.28} reduced={reduced} light={light} />
                </group>
              ))
            : positions.map((p, i) => {
                const v = vouchers[i];
                const on = hoverId === v.vouchId;
                return (
                  <group key={v.vouchId} position={p}>
                    <Star
                      glow={glow}
                      color={colors[i]}
                      coreSize={0.11}
                      glowScale={0.78}
                      hovered={on}
                      reduced={reduced}
                      light={light}
                      onOver={() => setHoverId(v.vouchId)}
                      onOut={() => setHoverId(null)}
                      onClick={() => onSelect(v)}
                    />
                    {on && (
                      <Html position={[0, 0.34, 0]} center distanceFactor={9} zIndexRange={[40, 0]}>
                        <div className="pointer-events-none -translate-y-2 whitespace-nowrap rounded-full border border-border bg-popover/90 px-2.5 py-1 text-2xs text-foreground backdrop-blur">
                          <span className="font-mono">{shortAddr(v.from)}</span>
                          {v.created ? <span className="text-muted-foreground"> · {timeAgo(v.created, locale)}</span> : null}
                        </div>
                      </Html>
                    )}
                  </group>
                );
              })}
        </group>
      </group>
    </>
  );
}

export default function ConstellationHero3D({ address, handle }: { address: string; handle: string }) {
  const t = useTranslations();
  const { locale } = useLocale();
  const numberFormat = new Intl.NumberFormat(locale === 'tr' ? 'tr-TR' : 'en-US');
  const [vouchers, setVouchers] = useState<VoucherStar[] | null>(null);
  // Everyone who vouched you (durable on-chain count) — the stars only cover the RPC window.
  const [vouchedBy, setVouchedBy] = useState<number | null>(null);
  const [selected, setSelected] = useState<VoucherStar | null>(null);
  const [hoverId, setHoverId] = useState<number | null>(null);
  // A read failure must NOT look like an empty sky — they mean opposite things.
  const [loadFailed, setLoadFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const light = useLightTheme();
  const frameloop = useFrameloop(containerRef, reduced);

  useEffect(() => {
    let alive = true;
    setVouchers(null);
    setVouchedBy(null);
    setSelected(null);
    setLoadFailed(false);
    fetchVouchersOf(address)
      .then((v) => alive && setVouchers(v))
      .catch(() => {
        if (alive) {
          setVouchers([]);
          setLoadFailed(true);
        }
      });
    getPeopleCounts(address)
      .then((p) => {
        if (alive) setVouchedBy(p.vouchedBy);
      })
      .catch(() => {
        if (alive) setVouchedBy(0);
      });
    return () => {
      alive = false;
    };
  }, [address]);

  const invalidateRef = useRef<(() => void) | null>(null);
  const invalidate = useCallback(() => {
    invalidateRef.current?.();
  }, []);

  // The copy counts everyone who vouched you, not just the stars the window can draw — and
  // never fewer than the stars actually on screen.
  const shown = vouchers?.length ?? 0;
  const count = Math.max(vouchedBy ?? 0, shown);

  return (
    <section
      aria-label={t('constellation.label')}
      className="relative overflow-hidden rounded-3xl border border-border/60"
    >
      <div className="aurora absolute inset-0" />
      <div className="grid-faint absolute inset-0" />

      <div ref={containerRef} className={`relative ${HERO_BOX} w-full`}>
        <Canvas
          camera={{ position: [0, 0, 7.6], fov: 50 }}
          dpr={[1, 2]}
          gl={{ alpha: true, antialias: true }}
          frameloop={frameloop}
          style={{ background: 'transparent' }}
        >
          <InvalidateBridge invalidateRef={invalidateRef} />
          <Scene
            vouchers={vouchers ?? []}
            reduced={reduced}
            light={light}
            onSelect={setSelected}
            hoverId={hoverId}
            setHoverId={setHoverId}
            locale={locale}
          />
        </Canvas>

        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-5 sm:p-7">
          <div>
            <p className="eyebrow">{t('constellation.label')}</p>
            <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-foreground text-glow sm:text-5xl">
              @{handle}
            </h1>
          </div>
          <p className="max-w-md text-sm text-muted-foreground" aria-live="polite">
            {vouchers === null || vouchedBy === null
              ? t('constellation.reading')
              : loadFailed && count === 0
                ? t('constellation.loadError')
                : count === 0
                  ? t('constellation.empty')
                  : count === 1
                    ? t('constellation.oneStar')
                    : `${t('constellation.manyStars', { count: numberFormat.format(count) })}${shown > 0 ? ` ${t('constellation.hoverStar')}` : ''}`}
          </p>
        </div>

        {/* Accessible, non-visual mirror of the sky: keyboard/screen-reader users get the
            same social proof the 3D hover tooltips show sighted-mouse users. */}
        {shown > 0 && (
          <ul className="sr-only" aria-label={t('constellation.peopleVouchedFor', { count: numberFormat.format(count) })}>
            {vouchers!.map((v) => (
              <li key={v.vouchId}>
                {shortAddr(v.from)}
                {v.note ? ` — “${v.note}”` : ''}
                {v.created ? ` (${timeAgo(v.created, locale)})` : ''}
              </li>
            ))}
          </ul>
        )}

        {selected && (
          <div className="pointer-events-auto absolute bottom-5 right-5 max-w-[16rem] rounded-2xl glass p-3.5 sm:bottom-7 sm:right-7" onPointerEnter={invalidate}>
            <button
              onClick={() => setSelected(null)}
              className="absolute right-2 top-2 text-xs text-muted-foreground hover:text-foreground"
              aria-label={t('constellation.dismiss')}
            >
              ✕
            </button>
            <p className="text-sm">
              {selected.note ? (
                <span className="italic text-foreground/90">&ldquo;{selected.note}&rdquo;</span>
              ) : (
                <span className="text-muted-foreground">{t('constellation.vouchedForYou')}</span>
              )}
            </p>
            <p className="mt-1.5 font-mono text-xs text-muted-foreground">
              {shortAddr(selected.from)}
              {selected.created ? ` · ${timeAgo(selected.created, locale)}` : ''}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function InvalidateBridge({ invalidateRef }: { invalidateRef: MutableRefObject<(() => void) | null> }) {
  const { invalidate } = useThree();
  useEffect(() => {
    invalidateRef.current = invalidate;
    return () => {
      invalidateRef.current = null;
    };
  }, [invalidate, invalidateRef]);
  return null;
}

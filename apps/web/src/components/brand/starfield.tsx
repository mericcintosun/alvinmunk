'use client';

import { useEffect, useRef } from 'react';

/**
 * Cosmic starfield — a single GPU-friendly canvas: depth-layered stars that twinkle,
 * drift with mouse + scroll parallax, and the occasional shooting star. Honors
 * prefers-reduced-motion (renders a static field, no rAF). The CSS `nebula` background
 * glows behind the transparent canvas. This is the real "stars look like stars" layer.
 */
interface Star {
  x: number;
  y: number;
  r: number;
  depth: number; // 0 (far) .. 1 (near)
  base: number; // base alpha
  phase: number;
  speed: number;
  hue: number; // 40 warm-white · 24 amber · 255 violet
  light: number; // lightness %
}
interface Shoot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  len: number;
}

export function Starfield() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    let stars: Star[] = [];
    let shoots: Shoot[] = [];
    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    let scrollY = window.scrollY;
    let raf = 0;
    let t = 0;
    let lastShoot = 0;

    const mkStar = (): Star => {
      const depth = Math.random();
      const roll = Math.random();
      const hue = roll < 0.84 ? 40 : roll < 0.93 ? 24 : 255;
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.4 + depth * 1.5,
        depth,
        base: 0.25 + depth * 0.6,
        phase: Math.random() * Math.PI * 2,
        speed: 0.4 + Math.random() * 1.4,
        hue,
        light: hue === 40 ? 95 : hue === 24 ? 70 : 80,
      };
    };

    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.max(60, Math.min(440, Math.floor((w * h) / 5500)));
      stars = Array.from({ length: count }, mkStar);
    };

    const drawStar = (s: Star, alpha: number) => {
      const ox = mouse.x * (8 + s.depth * 34);
      const oy = mouse.y * (8 + s.depth * 34) - scrollY * s.depth * 0.12;
      let x = (s.x + ox) % w;
      if (x < 0) x += w;
      let y = (s.y + oy) % h;
      if (y < 0) y += h;
      ctx.beginPath();
      ctx.arc(x, y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${s.hue} 100% ${s.light}% / ${alpha})`;
      ctx.fill();
      if (s.depth > 0.7) {
        ctx.shadowBlur = 6;
        ctx.shadowColor = `hsla(${s.hue} 100% ${s.light}% / ${alpha})`;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    };

    const drawShoot = (sh: Shoot) => {
      const grad = ctx.createLinearGradient(sh.x, sh.y, sh.x - sh.vx * sh.len, sh.y - sh.vy * sh.len);
      grad.addColorStop(0, `hsla(40 100% 95% / ${sh.life})`);
      grad.addColorStop(1, 'hsla(40 100% 95% / 0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(sh.x, sh.y);
      ctx.lineTo(sh.x - sh.vx * sh.len, sh.y - sh.vy * sh.len);
      ctx.stroke();
    };

    const frame = (now: number) => {
      t = now / 1000;
      mouse.x += (mouse.tx - mouse.x) * 0.06;
      mouse.y += (mouse.ty - mouse.y) * 0.06;
      ctx.clearRect(0, 0, w, h);

      for (const s of stars) {
        const tw = 0.5 + 0.5 * Math.sin(t * s.speed + s.phase);
        drawStar(s, s.base * (0.45 + 0.55 * tw));
      }

      if (now - lastShoot > 4200 && Math.random() < 0.04) {
        lastShoot = now;
        const fromLeft = Math.random() < 0.5;
        shoots.push({
          x: fromLeft ? Math.random() * w * 0.4 : w - Math.random() * w * 0.4,
          y: Math.random() * h * 0.5,
          vx: (fromLeft ? 1 : -1) * (4 + Math.random() * 3),
          vy: 1.5 + Math.random() * 1.5,
          life: 1,
          len: 14 + Math.random() * 10,
        });
      }
      shoots = shoots.filter((sh) => sh.life > 0.02);
      for (const sh of shoots) {
        sh.x += sh.vx;
        sh.y += sh.vy;
        sh.life *= 0.94;
        drawShoot(sh);
      }

      raf = requestAnimationFrame(frame);
    };

    const renderStatic = () => {
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) drawStar(s, s.base);
    };

    const onResize = () => {
      resize();
      if (reduce) renderStatic();
    };
    const onMouse = (e: MouseEvent) => {
      mouse.tx = e.clientX / window.innerWidth - 0.5;
      mouse.ty = e.clientY / window.innerHeight - 0.5;
    };
    const onScroll = () => {
      scrollY = window.scrollY;
    };

    resize();
    window.addEventListener('resize', onResize);
    if (!reduce) {
      window.addEventListener('mousemove', onMouse, { passive: true });
      window.addEventListener('scroll', onScroll, { passive: true });
      raf = requestAnimationFrame(frame);
    } else {
      renderStatic();
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('mousemove', onMouse);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      className="nebula pointer-events-none fixed inset-0 -z-10 h-full w-full"
      aria-hidden
    />
  );
}

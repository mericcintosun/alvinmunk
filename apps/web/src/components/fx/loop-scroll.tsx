'use client';

import { useState } from 'react';
import { motion } from 'motion/react';
import { Frame } from './frame';
import { cn } from '@/lib/utils';

const STEPS = [
  { n: '01', t: 'Vouch', tag: 'mint · one line', d: 'Pick someone you trust and add one line — why. No address needed; you get a share link that lights a star for them.' },
  { n: '02', t: 'Claim', tag: 'one tap · sponsored', d: 'They open the link, connect in a single tap (fees sponsored), and claim their half. Two halves become one card; both earn Social XP.' },
  { n: '03', t: 'Constellation', tag: 'on-chain · forever', d: 'Every claimed vouch adds a star. Your passport is a living constellation that grows with the people who back you — readable by any app.' },
];

/**
 * Scrollytelling for the vouch loop — a sticky technical Frame on the left whose step
 * swaps as the tall trigger blocks on the right scroll through the viewport's center
 * band. The "scroll-triggered scene". Reduced-motion still works (content just swaps).
 */
export function LoopScroll() {
  const [active, setActive] = useState(0);

  return (
    <div className="relative grid gap-6 md:grid-cols-2 md:gap-10">
      {/* sticky scrollytelling panel — desktop only (mobile uses the stacked blocks) */}
      <div className="hidden md:sticky md:top-28 md:block md:h-[64vh] md:self-start">
        <Frame label="the_loop" index={`0${active + 1} / 03`} className="flex h-full flex-col justify-center p-8 md:p-10">
          <span className="font-mono text-xs uppercase tracking-[0.2em] text-primary/60">step {STEPS[active].n}</span>
          <motion.h3
            key={active}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="mt-3 font-display text-5xl font-semibold tracking-tight"
          >
            {STEPS[active].t}
          </motion.h3>
          <motion.p
            key={`${active}-d`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.05 }}
            className="mt-4 max-w-sm text-muted-foreground"
          >
            {STEPS[active].d}
          </motion.p>
          <div className="mt-8 flex gap-2">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={cn('h-1 rounded-full transition-all duration-300', i === active ? 'w-12 bg-primary' : 'w-6 bg-border')}
              />
            ))}
          </div>
        </Frame>
      </div>

      <div>
        {STEPS.map((s, i) => (
          <motion.div
            key={s.n}
            onViewportEnter={() => setActive(i)}
            viewport={{ margin: '-45% 0px -45% 0px', amount: 0.2 }}
            className="flex min-h-0 flex-col justify-center border-l border-border/50 py-7 pl-6 md:min-h-[72vh] md:py-0 md:pl-8"
          >
            <span className="font-display text-7xl font-semibold leading-none text-primary/15">{s.n}</span>
            <h4 className="mt-3 text-2xl font-semibold">{s.t}</h4>
            <p className="mt-2 max-w-md text-muted-foreground">{s.d}</p>
            <span className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{s.tag}</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

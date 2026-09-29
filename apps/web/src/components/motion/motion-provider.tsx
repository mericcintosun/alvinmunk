'use client';

import { MotionConfig } from 'motion/react';

/**
 * Makes every motion animation honour the OS reduce-motion setting: transforms (rises,
 * slides, scales) jump straight to their end state while opacity fades still run.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

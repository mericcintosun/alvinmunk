'use client';

import React, { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface DialogProps {
  open: boolean;
  /** Escape, a click on the backdrop, or the caller's own cancel button. */
  onClose: () => void;
  /** The id of the element that names the dialog (its title). */
  labelledBy: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * A modal dialog: focus moves in on open and back to where it was on close, Tab cycles
 * inside it (the content may change while open, so the focusable set is read on every
 * Tab), and Escape or a backdrop click closes it.
 */
export function Dialog({ open, onClose, labelledBy, children, className }: DialogProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  // The latest onClose, so a re-render with a new callback never re-runs the focus effect.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusables = () => [...(contentRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    (focusables()[0] ?? contentRef.current)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const inside = contentRef.current?.contains(document.activeElement) ?? false;
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={cn('w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-popover outline-none', className)}
      >
        {children}
      </div>
    </div>
  );
}

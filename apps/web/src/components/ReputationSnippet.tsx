import React from 'react';
import { REPUTATION_READ_FILE, reputationReadSnippet } from '@/lib/reputation-read-snippet';
import { cn } from '@/lib/utils';

/** The shared "read reputation from your own app" code frame (landing, /how-it-works, /score). */
export function ReputationSnippet({ address, className }: { address?: string; className?: string }) {
  return (
    <div className={cn('border border-border/70 bg-background/70', className)}>
      <div className="flex items-center gap-1.5 border-b border-border/60 px-3 py-2">
        <span className="size-2.5 rounded-full bg-destructive/70" />
        <span className="size-2.5 rounded-full bg-warning/70" />
        <span className="size-2.5 rounded-full bg-secondary/70" />
        <span className="ml-2 font-mono text-2xs text-muted-foreground">{REPUTATION_READ_FILE}</span>
      </div>
      <pre className="overflow-x-auto p-5 font-mono text-xs leading-relaxed text-foreground/80">
        {reputationReadSnippet(address)}
      </pre>
    </div>
  );
}

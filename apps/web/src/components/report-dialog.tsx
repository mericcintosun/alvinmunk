'use client';

import { useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

export function ReportDialog({
  open,
  onClose,
  target,
  vouchId,
}: {
  open: boolean;
  onClose: () => void;
  target: string;
  vouchId?: number;
}) {
  const [reason, setReason] = useState('impersonation');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, vouchId, reason, detail }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to submit report');
      }
      toast.success('Report submitted. Thank you.');
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error submitting report');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} labelledBy="report-title">
      <h2 id="report-title" className="text-xl font-semibold">Report</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Flag this content for admin review.
      </p>

      <div className="mt-4 grid gap-3">
        <label className="text-sm font-medium">Reason</label>
        <select
          className="h-11 rounded-xl border border-input bg-background/40 px-4 text-sm"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        >
          <option value="impersonation">Impersonation</option>
          <option value="offensive">Offensive handle or note</option>
          <option value="spam">Spam or fake accounts</option>
        </select>
        
        <label className="text-sm font-medium">Detail (optional)</label>
        <Textarea
          placeholder="Brief explanation"
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          rows={3}
        />
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={busy}>
          {busy ? 'Submitting...' : 'Submit Report'}
        </Button>
      </div>
    </Dialog>
  );
}

import type { ComponentType } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { Modal, btnGhost } from './Modal';

/** A deliberate second step before an irreversible action. */
export function ConfirmDialog({
  title,
  description,
  confirmLabel = 'Continue',
  cancelLabel = 'Keep it',
  confirmIcon: ConfirmIcon = Trash2,
  onConfirm,
  onCancel,
  pad = false,
}: {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmIcon?: ComponentType<{ className?: string }>;
  onConfirm: () => void;
  onCancel: () => void;
  /**
   * Let the overlay's controller reach the two answers. They are buttons
   * outside any box, so `data-overlay` is what tells the pad they are part of
   * the panel it is driving.
   */
  pad?: boolean;
}) {
  return (
    <Modal title={title} size="sm" onClose={onCancel}>
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-rose-400/25 bg-rose-500/10 text-rose-300">
          <AlertTriangle className="size-5" />
        </span>
        <p className="text-sm leading-relaxed text-muted">{description}</p>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" data-overlay={pad || undefined} className={btnGhost} onClick={onCancel}>
          {cancelLabel}
        </button>
        <button
          type="button"
          data-overlay={pad || undefined}
          className="flex items-center gap-2 rounded-lg border border-rose-400/35 bg-rose-500/15 px-4 py-2 text-sm font-semibold text-rose-200 transition hover:border-rose-300/70 hover:bg-rose-500/25"
          onClick={onConfirm}
        >
          <ConfirmIcon className="size-4" />
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

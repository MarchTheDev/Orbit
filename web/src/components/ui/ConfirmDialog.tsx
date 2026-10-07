import { AlertTriangle, Trash2 } from 'lucide-react';
import { Modal, btnGhost } from './Modal';

/** A deliberate second step before an irreversible action. */
export function ConfirmDialog({
  title,
  description,
  confirmLabel = 'Continue',
  onConfirm,
  onCancel,
}: {
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
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
        <button type="button" className={btnGhost} onClick={onCancel}>
          Keep it
        </button>
        <button
          type="button"
          className="flex items-center gap-2 rounded-lg border border-rose-400/35 bg-rose-500/15 px-4 py-2 text-sm font-semibold text-rose-200 transition hover:border-rose-300/70 hover:bg-rose-500/25"
          onClick={onConfirm}
        >
          <Trash2 className="size-4" />
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

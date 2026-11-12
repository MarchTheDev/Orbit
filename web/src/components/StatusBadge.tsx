import type { GameStatus } from '../types';

const STYLES: Record<GameStatus, string> = {
  playing: 'border-accent/50 bg-accent/12 text-accent',
  backlog: 'border-line bg-panel2 text-muted',
  completed: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
  dropped: 'border-rose-500/40 bg-rose-500/10 text-rose-400',
};

export function StatusBadge({ status }: { status: GameStatus }) {
  return (
    <span className={`w-fit rounded-full border px-2.5 py-0.5 text-[11px] font-medium capitalize ${STYLES[status]}`}>
      {status}
    </span>
  );
}

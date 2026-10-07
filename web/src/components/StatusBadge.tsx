import type { GameStatus } from '../types';

const STYLES: Record<GameStatus, string> = {
  playing: 'bg-sky-500/15 text-sky-400',
  backlog: 'bg-zinc-500/15 text-zinc-400',
  completed: 'bg-emerald-500/15 text-emerald-400',
  dropped: 'bg-rose-500/15 text-rose-400',
};

export function StatusBadge({ status }: { status: GameStatus }) {
  return <span className={`w-fit rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STYLES[status]}`}>{status}</span>;
}

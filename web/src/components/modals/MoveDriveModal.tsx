import { useEffect, useMemo, useState } from 'react';
import { Check, MoveRight, X } from 'lucide-react';
import type { Game } from '../../types';
import { diskSpace, moveGameToFolder } from '../../services/native';
import { fmtBytes } from '../../utils/format';
import { driveOf, isInside } from '../../utils/paths';
import { Modal, btnGhost, btnPrimary } from '../ui/Modal';
import { cn } from '../../utils/cn';
import { driveLabel } from '../../utils/drive';

interface Props {
  game: Game;
  folders: string[];
  onClose: () => void;
  onMoved: (installDir: string, exePath: string | null, drive: string) => void;
}

function freeOn(folder: string): Promise<number | null> {
  return diskSpace(folder).then((s) => (s ? s[1] : null));
}

/**
 * Move a game to another library folder.
 *
 * The targets are folders Orbit has been told about, not bare drive letters: a
 * move is a move between two places games actually live, and the native side
 * refuses anything outside them. Nothing is deleted until the copy has been
 * checked, and the original is left alone if anything goes wrong.
 */
export function MoveDriveModal({ game, folders, onClose, onMoved }: Props) {
  const installDir = game.installDir;
  const elsewhere = !installDir || !folders.some((f) => isInside(installDir, f));
  // Only same-drive folders are pointless as targets. A game whose drive was
  // never recorded gets every folder offered rather than none of them.
  const targets = useMemo(
    () => (game.drive ? folders.filter((f) => driveOf(f) !== driveOf(game.drive ?? '')) : folders),
    [folders, game.drive],
  );
  const [target, setTarget] = useState(targets[0] ?? '');
  const [space, setSpace] = useState<Record<string, number | null>>({});
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ dir: string; message: string | null } | null>(null);

  useEffect(() => {
    let alive = true;
    void Promise.all(targets.map(async (f) => [f, await freeOn(f)] as const)).then((rows) => {
      if (alive) setSpace(Object.fromEntries(rows));
    });
    return () => {
      alive = false;
    };
  }, [targets]);

  const move = async () => {
    if (!installDir) return;
    setError('');
    setProgress(0);
    try {
      const moved = await moveGameToFolder(installDir, target, folders, setProgress);
      const newDir = moved.installDir;
      const exePath =
        game.exePath && installDir && isInside(game.exePath, installDir)
          ? newDir + game.exePath.slice(installDir.length)
          : game.exePath;
      onMoved(newDir, exePath, newDir.slice(0, 2).toUpperCase());
      setDone({ dir: newDir, message: moved.message });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress(null);
    }
  };

  // While a move runs there is nothing to cancel, so the only way out is done.
  const locked = progress !== null && !done;

  return (
    <Modal
      title={done ? 'Moved' : `Move “${game.title}”`}
      onClose={locked ? () => {} : onClose}
      footer={
        done ? (
          <div className="flex justify-end">
            <button className={`${btnPrimary} flex items-center gap-2`} onClick={onClose}>
              <Check className="size-4" />
              Done
            </button>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <button onClick={onClose} disabled={locked} className={`${btnGhost} flex items-center gap-2`}>
              <X className="size-4" />
              Cancel
            </button>
            <button
              onClick={move}
              disabled={!target || locked || elsewhere}
              className={`${btnPrimary} flex items-center gap-2`}
            >
              <MoveRight className="size-4" />
              Move {game.sizeBytes > 0 ? fmtBytes(game.sizeBytes) : ''}
            </button>
          </div>
        )
      }
    >
      {done ? (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-sm text-emerald-400">
            <span className="grid size-5 place-items-center rounded-full bg-emerald-500/20">✓</span>
            The game is now in {done.dir}
          </p>
          {done.message ? (
            <p className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
              {done.message}
            </p>
          ) : (
            <p className="text-xs text-muted">The copy was checked and the original was removed.</p>
          )}
        </div>
      ) : (
        <>
          <p className="mb-1 text-sm text-muted">
            Currently on <b className="text-fg">{driveLabel(game.drive) || '-'}</b>
            {game.sizeBytes > 0 && ` · ${fmtBytes(game.sizeBytes)}`}
          </p>
          <p className="mb-3 break-all font-mono text-xs text-muted">{game.installDir}</p>

          {elsewhere && (
            <p className="mb-4 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
              This game sits outside your library folders, so Orbit will not move it. Move the files yourself, then update the
              path on the game.
            </p>
          )}

          {targets.length === 0 ? (
            <p className="mb-4 text-sm text-muted">Add another library folder on the Storage page to move games.</p>
          ) : (
            <div className="mb-4 grid gap-2">
              {targets.map((f) => (
                <button
                  key={f}
                  disabled={locked}
                  onClick={() => setTarget(f)}
                  className={cn('rounded-xl border p-3 text-left', target === f ? 'border-accent bg-accent/15' : 'border-line bg-panel2')}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-sm">{f}</span>
                    {space[f] !== null && space[f] !== undefined && (
                      <span className="shrink-0 text-xs text-muted">{fmtBytes(space[f]!)} free</span>
                    )}
                  </div>
                  {game.sizeBytes > 0 && space[f] !== null && space[f] !== undefined && space[f]! < game.sizeBytes && (
                    <span className="text-xs text-rose-400">Not enough free space there</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {locked && (
            <div className="mb-4">
              {progress >= 0 ? (
                <div className="h-2 overflow-hidden rounded-full bg-bg">
                  <div
                    className="h-full bg-gradient-to-r from-accent to-accent2 transition-all"
                    style={{ width: `${Math.round(progress * 100)}%` }}
                  />
                </div>
              ) : (
                // A folder too large to measure still moves; Orbit just cannot say how far along it is.
                <div className="h-2 overflow-hidden rounded-full bg-bg">
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-gradient-to-r from-accent to-accent2" />
                </div>
              )}
              <p className="mt-1 text-xs text-muted">
                {progress >= 1 ? 'Checking the copy…' : progress < 0 ? 'Copying files…' : `Copying files… ${Math.round(progress * 100)}%`}
              </p>
              <p className="mt-0.5 text-[11px] text-muted">Do not close Orbit until this finishes.</p>
            </div>
          )}

          {error && <p className="text-sm text-rose-400">{error}</p>}
        </>
      )}
    </Modal>
  );
}
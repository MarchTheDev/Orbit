/**
 * The Proton-GE shelf.
 *
 * A game's Windows build runs through whatever Proton it is pointed at, and the
 * community's own build fixes a long tail of games that Valve's does not. It is
 * a download rather than a setting, so it lives behind one button: the newest
 * few releases, a size, and a line saying which is already here. Fetching one
 * happens in the background - the same progress bar the launching uses - so the
 * panel can stay open while it downloads.
 */
import { useCallback, useEffect, useState } from 'react';
import { Modal, btnGhost, btnPrimary } from '../ui/Modal';
import {
  protonBuilds,
  protonInstall,
  protonReleases,
  protonRemove,
  watchLaunchStatus,
  watchProtonProgress,
  type ProtonProgress,
} from '../../services/native';
import { fmtBytes } from '../../utils/format';
import { sortReleases } from '../../utils/proton';
import { say } from '../../utils/toast';
import type { ProtonBuild, ProtonRelease } from '../../types';

export function ProtonManager({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  /** Told whenever a build arrives or goes, so the picker can be refilled. */
  onChanged: () => void;
}) {
  const [releases, setReleases] = useState<ProtonRelease[]>([]);
  const [builds, setBuilds] = useState<ProtonBuild[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>('');
  /** How far the fetch under way has got, in bytes. */
  const [fetching, setFetching] = useState<ProtonProgress | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, mine] = await Promise.all([protonReleases(), protonBuilds()]);
      setReleases(sortReleases(list));
      setBuilds(mine.filter((b) => b.orbit));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  // The desktop says what it is doing while it fetches, one line at a time,
  // and the bar behind it is counted in bytes as they land.
  useEffect(() => {
    if (!open) return;
    const unwatchText = watchLaunchStatus((text) => setProgress(text));
    const unwatchBytes = watchProtonProgress((p) => setFetching(p.phase === 'done' ? null : p));
    return () => {
      unwatchText();
      unwatchBytes();
    };
  }, [open]);

  async function install(release: ProtonRelease) {
    setBusy(release.tag);
    setFetching(null);
    setProgress(`Fetching ${release.tag}`);
    try {
      const where = await protonInstall(release.tag, release.url);
      say(`${release.tag} is ready`, 'ok');
      setProgress(where ? `Installed to ${where}` : '');
      onChanged();
      await refresh();
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), 'error');
      setProgress('');
    } finally {
      setBusy(null);
      setFetching(null);
    }
  }

  async function remove(build: ProtonBuild) {
    setBusy(build.id);
    try {
      await protonRemove(build.path);
      say(`${build.name} was removed`, 'ok');
      onChanged();
      await refresh();
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(null);
    }
  }

  // A fetch that stumbled can still have put files on disk, and a fetch that
  // went through must refill the picker's list either way: closing hands the
  // truth of the shelf back to the page under this one, whatever the outcome.
  const close = () => {
    onChanged();
    onClose();
  };

  if (!open) return null;

  return (
    <Modal onClose={close} title="Proton-GE" size="lg">
      <div className="flex flex-col gap-5">
        <p className="text-sm text-fg-dim">
          Proton-GE is the community build of Proton. It carries newer DXVK and the
          patches Valve's build leaves out, which is why so many games run better on
          it. Downloaded builds live in Orbit's own folder and are offered for every
          game.
        </p>

        {progress && (
          <div className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-fg-dim">
            {progress}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        <section className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-dim">
              Newest releases
            </h3>
            <button
              type="button"
              className="text-xs text-fg-dim underline underline-offset-2 hover:text-fg"
              onClick={() => void refresh()}
              disabled={loading}
            >
              {loading ? 'Checking…' : 'Check again'}
            </button>
          </div>

          {!loading && releases.length === 0 && !error && (
            <p className="rounded-lg border border-line bg-surface-2 px-3 py-3 text-xs text-fg-dim">
              Nothing came back from GitHub. Check the connection, then try again.
            </p>
          )}

          <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
            {releases.map((release) => (
              <li
                key={release.tag}
                className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm text-fg">{release.tag}</div>
                  <div className="text-xs text-fg-dim">
                    {release.size > 0 ? fmtBytes(release.size) : 'size unknown'}
                    {release.published ? ` · ${release.published.slice(0, 10)}` : ''}
                    {release.installed ? ' · already here' : ''}
                  </div>
                </div>
                {release.installed ? (
                  <span className="shrink-0 text-xs text-fg-dim">Installed</span>
                ) : busy === release.tag ? (
                  /* Half a gigabyte is long enough to grow tired of believing a
                     word: the same counting the move of a game to another disk
                     gets, as a bar and two numbers. */
                  <div className="flex w-44 shrink-0 flex-col gap-1">
                    {fetching?.tag === release.tag && fetching.phase === 'download' && fetching.total > 0 ? (
                      <>
                        <div className="h-1.5 overflow-hidden rounded-full bg-panel2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((fetching.loaded / fetching.total) * 100)}>
                          <div
                            className="h-full rounded-full bg-accent transition-[width] duration-200"
                            style={{ width: `${Math.min(100, (fetching.loaded / fetching.total) * 100)}%` }}
                          />
                        </div>
                        <p className="text-right text-[10px] leading-none text-fg-dim">
                          {Math.round((fetching.loaded / fetching.total) * 100)}% · {fmtBytes(fetching.loaded)} of {fmtBytes(fetching.total)}
                        </p>
                      </>
                    ) : fetching?.tag === release.tag && fetching.phase === 'download' ? (
                      <p className="text-right text-[10px] leading-none text-fg-dim">{fmtBytes(fetching.loaded)} fetched…</p>
                    ) : fetching?.tag === release.tag && fetching.phase === 'extract' ? (
                      <p className="text-right text-[10px] leading-none text-fg-dim">Unpacking…</p>
                    ) : (
                      <p className="text-right text-[10px] leading-none text-fg-dim">Starting the fetch…</p>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    className={btnPrimary}
                    disabled={busy !== null}
                    onClick={() => void install(release)}
                  >
                    Download
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-dim">
            Downloaded by Orbit
          </h3>
          {builds.length === 0 ? (
            <p className="text-xs text-fg-dim">
              None yet. Builds that Steam or another launcher installed are left in
              their own folders, so they can only be removed there.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {builds.map((build) => (
                <li
                  key={build.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm text-fg">{build.name}</div>
                    <div className="truncate text-xs text-fg-dim">{build.path}</div>
                  </div>
                  <button
                    type="button"
                    className={btnGhost}
                    disabled={busy !== null}
                    onClick={() => void remove(build)}
                  >
                    {busy === build.id ? 'Removing…' : 'Remove'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="flex justify-end">
          <button type="button" className={btnGhost} onClick={close}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

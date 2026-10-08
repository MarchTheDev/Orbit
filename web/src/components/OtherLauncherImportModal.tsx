import { useEffect, useMemo, useState } from 'react';
import { Download, LoaderCircle, RefreshCw, Square, SquareCheck, X } from 'lucide-react';
import type { Game, LauncherGame, OtherLauncher } from '../types';
import { isNative, launcherGames } from '../services/native';
import { fmtBytes } from '../utils/format';
import { gameFromLauncher, normalizeInstallPath } from '../utils/launcherGame';
import { Modal, btnGhost, btnPrimary } from './ui/Modal';
import { CheckboxBox } from './ui/Checkbox';
import { SearchField } from './ui/SearchField';

interface Row extends LauncherGame {
  include: boolean;
}

/**
 * An explicit, local-only import from launchers other than Steam.
 *
 * The scan reads install manifests/registry records and does not sign in,
 * contact a launcher, change its data, or start anything. Only checked titles
 * are added, and they are saved as timer-only games so Orbit never guesses that
 * a game can safely bypass its launcher.
 */
export function OtherLauncherImportModal({ existing, launcher, onAdd, onClose }: {
  existing: Game[];
  launcher?: OtherLauncher;
  onAdd: (games: Game[]) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const knownPaths = useMemo(
    () => new Set(existing.map((game) => normalizeInstallPath(game.installDir)).filter(Boolean)),
    [existing],
  );
  const knownTitles = useMemo(
    () => new Set(existing.map((game) => game.title.trim().toLocaleLowerCase())),
    [existing],
  );

  /** Whether an install is already in the library, and so listed but not tickable. */
  const isKnown = (game: Row) =>
    knownPaths.has(normalizeInstallPath(game.installDir)) ||
    knownTitles.has(game.name.trim().toLocaleLowerCase());

  const scan = async () => {
    setBusy(true);
    setError(null);
    try {
      const found = await launcherGames(launcher);
      found.sort((a, b) => a.launcher.localeCompare(b.launcher) || a.name.localeCompare(b.name));
      setRows(found.map((game) => ({
        ...game,
        // Unticked, so opening the dialog never puts a whole library one click
        // away from being added. Selecting all of it is one click too.
        include: false,
      })));
      if (found.length === 0) {
        setError(launcher
          ? `No ${launcher} installs were found in the local records Orbit supports. Nothing was contacted or changed.`
          : 'No supported installed games were found. Orbit checked local launcher records only; nothing was contacted or changed.');
      }
    } catch (reason) {
      setRows([]);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (isNative()) void scan();
    else setRows([]);
    // Opening this dialog is the user's explicit request to scan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = (rows ?? []).filter((game) => {
    const term = filter.trim().toLocaleLowerCase();
    return !term || `${game.name} ${game.launcher} ${game.installDir}`.toLocaleLowerCase().includes(term);
  });
  const groups = [...visible.reduce((byLauncher, game) => {
    const group = byLauncher.get(game.launcher) ?? [];
    group.push(game);
    byLauncher.set(game.launcher, group);
    return byLauncher;
  }, new Map<string, Row[]>())].sort(([a], [b]) => a.localeCompare(b));
  const selected = (rows ?? []).filter((game) => game.include);

  /** Every tickable install in the whole scan, and the ones on screen. */
  const tickable = (rows ?? []).filter((game) => !isKnown(game));
  const inView = visible.filter((game) => !isKnown(game));
  const allChosen = inView.length > 0 && inView.every((game) => game.include);

  /**
   * Tick or untick everything on screen at once, across every launcher shown.
   *
   * It follows the filter rather than the whole scan, because selecting a
   * hundred installs that a search was hiding is the accident to avoid. The
   * buttons on each launcher group still work one group at a time.
   */
  const toggleAll = () => {
    const paths = new Set(inView.map((game) => normalizeInstallPath(game.installDir)));
    setRows((current) => (current ?? []).map((game) =>
      paths.has(normalizeInstallPath(game.installDir))
        ? { ...game, include: !allChosen }
        : game,
    ));
  };

  const toggleLauncher = (launcher: string, group: Row[]) => {
    const importable = group.filter((game) => !isKnown(game));
    const allSelected = importable.length > 0 && importable.every((game) => game.include);
    const paths = new Set(importable.map((game) => normalizeInstallPath(game.installDir)));
    setRows((current) => (current ?? []).map((game) =>
      game.launcher === launcher && paths.has(normalizeInstallPath(game.installDir))
        ? { ...game, include: !allSelected }
        : game,
    ));
  };

  const toggle = (installDir: string) => {
    setRows((current) => (current ?? []).map((game) => (
      normalizeInstallPath(game.installDir) === normalizeInstallPath(installDir)
        ? { ...game, include: !game.include }
        : game
    )));
  };

  const addSelected = () => {
    if (selected.length === 0) return;
    setSaving(true);
    try {
      const games: Game[] = selected.map(gameFromLauncher);
      onAdd(games);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={launcher ? `Import ${launcher}` : 'Other game launchers'}
      subtitle={launcher
        ? `A read-only scan of ${launcher} install records on this device. Nothing is added until you select it.`
        : 'A read-only scan of local install records. Nothing is added until you select it.'}
      size="xl"
      onClose={onClose}
      footer={(
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted">{selected.length} of {tickable.length} selected</span>
          <div className="flex gap-2">
            <button className={`${btnGhost} flex items-center gap-2`} onClick={onClose} disabled={saving}>
              <X className="size-4" /> Cancel
            </button>
            <button className={`${btnPrimary} flex items-center gap-2`} onClick={addSelected} disabled={selected.length === 0 || saving}>
              {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
              {saving ? 'Adding…' : `Add ${selected.length || ''} ${selected.length === 1 ? 'game' : 'games'}`}
            </button>
          </div>
        </div>
      )}
    >
      <div className="space-y-4">
        {!isNative() && (
          <p className="rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-100">
            The browser preview cannot read local launcher records. Open Orbit as the desktop app to scan this PC.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {/* One square, on the left where the eye lands first: tick every
              install in view, across every launcher shown, or untick them. */}
          <button
            className="grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-panel2 text-muted transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
            onClick={toggleAll}
            disabled={inView.length === 0}
            title={
              inView.length === 0
                ? 'Nothing here to select'
                : `${allChosen ? 'Deselect' : 'Select'} all ${inView.length} ${
                    inView.length === 1 ? 'install' : 'installs'
                  }${filter.trim() ? ' the filter shows' : ''}`
            }
            aria-label={allChosen ? 'Deselect all' : 'Select all'}
          >
            {allChosen ? <Square className="size-4" /> : <SquareCheck className="size-4" />}
          </button>
          <SearchField
            value={filter}
            onChange={setFilter}
            placeholder={launcher ? `Filter ${launcher} games or folders` : "Filter by game, launcher, or folder"}
            className="min-w-[14rem] flex-1"
            inputClassName="w-full"
          />
          <button className={`${btnGhost} flex items-center gap-2`} onClick={() => void scan()} disabled={busy || !isNative()}>
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            {busy ? 'Scanning…' : 'Scan again'}
          </button>
        </div>

        {error && <p className="rounded-xl border border-line bg-panel2/50 px-3 py-2 text-xs leading-relaxed text-muted">{error}</p>}

        {busy && !rows && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
            <LoaderCircle className="size-4 animate-spin" /> Reading local records…
          </div>
        )}

        {(rows?.length ?? 0) > 0 && (
          <ul className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
            {groups.map(([launcher, games]) => {
              const importable = games.filter((game) => !isKnown(game));
              const selectedInGroup = importable.filter((game) => game.include).length;
              const allSelected = importable.length > 0 && selectedInGroup === importable.length;
              return (
                <li key={launcher} className="rounded-2xl border border-line/70 bg-bg/25 p-2.5">
                  <div className="mb-2 flex items-center justify-between gap-3 px-1">
                    <div className="min-w-0">
                      <h3 className="truncate text-xs font-semibold uppercase tracking-widest text-fg">{launcher}</h3>
                      <p className="mt-0.5 text-[10px] text-muted">
                        {games.length} {games.length === 1 ? 'install' : 'installs'}
                        {importable.length > 0 && ` · ${selectedInGroup} selected`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleLauncher(launcher, games)}
                      disabled={importable.length === 0}
                      className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-[10px] font-medium text-muted transition hover:border-accent hover:text-fg disabled:opacity-40"
                    >
                      {allSelected ? 'Clear selection' : 'Select all'}
                    </button>
                  </div>
                  <ul className="space-y-1">
                    {games.map((game) => {
                      const known = isKnown(game);
                      return (
                        <li key={`${game.launcher}:${normalizeInstallPath(game.installDir)}`}>
                          <div className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${known ? 'border-line bg-panel2/20' : 'border-line bg-panel2/40 hover:border-accent/50'}`}>
                            <CheckboxBox
                              checked={game.include}
                              onChange={() => toggle(game.installDir)}
                              disabled={known}
                              title={known ? 'Already in the library' : `Add ${game.name}`}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-fg">{game.name}</p>
                              <p className="mt-0.5 truncate text-[11px] text-muted">
                                {known ? 'Already in the library' : game.installDir}
                              </p>
                            </div>
                            {game.sizeBytes > 0 && <span className="shrink-0 text-xs text-muted">{fmtBytes(game.sizeBytes)}</span>}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
            {visible.length === 0 && <li className="px-3 py-3 text-sm text-muted">No installs match that search.</li>}
          </ul>
        )}


      </div>
    </Modal>
  );
}

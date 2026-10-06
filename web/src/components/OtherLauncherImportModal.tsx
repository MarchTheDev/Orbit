import { useEffect, useMemo, useState } from 'react';
import { Download, LoaderCircle, RefreshCw, Search, X } from 'lucide-react';
import type { Game, LauncherGame } from '../types';
import { isNative, launcherGames } from '../services/native';
import { fmtBytes, hashHue, uid } from '../utils/format';
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
export function OtherLauncherImportModal({ existing, onAdd, onClose }: {
  existing: Game[];
  onAdd: (games: Game[]) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const knownPaths = useMemo(
    () => new Set(existing.map((game) => normalizedPath(game.installDir)).filter(Boolean)),
    [existing],
  );
  const knownTitles = useMemo(
    () => new Set(existing.map((game) => game.title.trim().toLocaleLowerCase())),
    [existing],
  );

  const scan = async () => {
    setBusy(true);
    setError(null);
    try {
      const found = await launcherGames();
      found.sort((a, b) => a.launcher.localeCompare(b.launcher) || a.name.localeCompare(b.name));
      setRows(found.map((game) => ({
        ...game,
        include: !knownPaths.has(normalizedPath(game.installDir)) && !knownTitles.has(game.name.trim().toLocaleLowerCase()),
      })));
      if (found.length === 0) {
        setError('No supported installed games were found. Orbit checked local launcher records only; nothing was contacted or changed.');
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
  const selected = (rows ?? []).filter((game) => game.include);

  const toggle = (installDir: string) => {
    setRows((current) => (current ?? []).map((game) => (
      normalizedPath(game.installDir) === normalizedPath(installDir)
        ? { ...game, include: !game.include }
        : game
    )));
  };

  const addSelected = () => {
    if (selected.length === 0) return;
    setSaving(true);
    try {
      const games: Game[] = selected.map((row) => {
        const drive = /^[a-z]:/i.test(row.installDir) ? row.installDir.slice(0, 2).toUpperCase() : '';
        return {
          id: uid(),
          title: row.name,
          inLibrary: true,
          launch: { kind: 'none' },
          exePath: null,
          installDir: row.installDir,
          drive,
          sizeBytes: row.sizeBytes,
          sizeGb: Math.round((row.sizeBytes / 1e9) * 10) / 10,
          status: 'backlog',
          favorite: false,
          manualPlaySecs: 0,
          playSecs: 0,
          lastPlayed: null,
          addedAt: new Date().toISOString(),
          notes: '',
          hue: hashHue(row.name),
          coverPath: null,
          sessionCount: 0,
          longestSecs: 0,
          running: false,
          companions: [],
        };
      });
      onAdd(games);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Other game launchers"
      subtitle="A read-only scan of local install records. Nothing is added until you select it."
      size="xl"
      onClose={onClose}
      footer={(
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted">{selected.length} of {rows?.length ?? 0} selected</span>
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
          <SearchField
            value={filter}
            onChange={setFilter}
            placeholder="Filter by game, launcher, or folder"
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
          <ul className="max-h-[28rem] space-y-1 overflow-y-auto pr-1">
            {visible.map((game) => {
              const known = knownPaths.has(normalizedPath(game.installDir)) || knownTitles.has(game.name.trim().toLocaleLowerCase());
              return (
                <li key={`${game.launcher}:${normalizedPath(game.installDir)}`}>
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
                        <span className="text-accent">{game.launcher}</span>
                        {known ? ' · already in the library' : ` · ${game.installDir}`}
                      </p>
                    </div>
                    {game.sizeBytes > 0 && <span className="shrink-0 text-xs text-muted">{fmtBytes(game.sizeBytes)}</span>}
                  </div>
                </li>
              );
            })}
            {visible.length === 0 && <li className="px-3 py-3 text-sm text-muted">No installs match that search.</li>}
          </ul>
        )}

        <div className="flex items-start gap-2 rounded-xl border border-line/70 bg-bg/40 px-3 py-2.5 text-xs leading-relaxed text-muted">
          <Search className="mt-0.5 size-3.5 shrink-0 text-accent" />
          <p>
            Orbit reads Epic manifests and Windows install records for Ubisoft Connect, GOG Galaxy, and EA. It does not sign in, scan game files, modify launcher data, or start games. Imported games are time-only until you choose a launch target in their details.
          </p>
        </div>
      </div>
    </Modal>
  );
}

function normalizedPath(path: string | null | undefined) {
  return path?.replace(/[\\/]+$/, '').replace(/\//g, '\\').toLocaleLowerCase() ?? '';
}

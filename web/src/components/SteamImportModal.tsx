import { useEffect, useState } from 'react';
import { Download, LoaderCircle, RefreshCw, Trash2, X } from 'lucide-react';
import type { Game, SteamGame } from '../types';
import { isNative, steamLibrary } from '../services/native';
import { fetchMetadata } from '../services/metadata';
import { fetchHltb } from '../services/hltb';
import { fmtBytes, fmtDate, hashHue, uid } from '../utils/format';
import { Modal, btnGhost, btnPrimary, inputCls } from './ui/Modal';
import { CheckboxBox } from './ui/Checkbox';
import { SearchField } from './ui/SearchField';

/**
 * Bring games over from the Steam library installed on this PC.
 *
 * Nothing here is automatic. The library is only read when this dialog is
 * opened, and a game is only added once it has been ticked, so a Steam account
 * with two hundred games never lands in the library by surprise.
 */
export function SteamImportModal({
  existing,
  fetchMeta,
  onAdd,
  onUpdate,
  onRemoveSteam,
  onClose,
}: {
  existing: Game[];
  /** Whether the player wants details and artwork fetched as games come in. */
  fetchMeta: boolean;
  onAdd: (games: Game[]) => void;
  onUpdate: (id: string, patch: Partial<Game>) => void;
  /** Removes every game that came in from Steam. Confirmed by the caller. */
  onRemoveSteam: () => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<(SteamGame & { include: boolean })[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [manual, setManual] = useState('');

  /** Games already here, by Steam id and by name, so nothing arrives twice. */
  const byId = existing.filter((g) => g.meta?.steamAppId).map((g) => g.meta!.steamAppId!);
  const byTitle = existing.map((g) => g.title.trim().toLowerCase());
  const fromSteam = existing.filter((g) => g.launch.kind === 'steam' || g.meta?.steamAppId);

  const scan = async () => {
    setBusy(true);
    setError(null);
    try {
      const found = await steamLibrary();
      // Steam hands the library over in no particular order; most recently
      // played first is the order that makes this dialog useful.
      found.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0));
      setRows(
        found.map((g) => ({
          ...g,
          include: !byId.includes(g.appId) && !byTitle.includes(g.name.trim().toLowerCase()),
        })),
      );
      if (found.length === 0) {
        setError(
          'Nothing was found to import. If Steam is installed somewhere unusual, add a game by its app id below.',
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Opening the dialog is the opt-in, so it reads the library straight away; a
  // second click to confirm would only be ceremony.
  useEffect(() => {
    if (isNative()) void scan();
    else setRows([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (appId: number) =>
    setRows((list) => (list ?? []).map((r) => (r.appId === appId ? { ...r, include: !r.include } : r)));

  /**
   * Artwork, description and completion times, once the games are already saved.
   *
   * Nothing here can fail the import: a store that does not know a title leaves
   * the game exactly as it was added.
   */
  const enrich = async (games: Game[]) => {
    if (!fetchMeta) return;
    await Promise.all(
      games.map(async (g) => {
        const [meta, hltb] = await Promise.allSettled([
          fetchMetadata(g.title, g.meta?.steamAppId ?? undefined),
          fetchHltb(g.title),
        ]);
        onUpdate(g.id, {
          ...(meta.status === 'fulfilled' ? { meta: meta.value, title: meta.value.name || g.title } : {}),
          ...(hltb.status === 'fulfilled' ? { hltb: hltb.value } : {}),
        });
      }),
    );
  };

  const addSelected = async () => {
    const chosen = (rows ?? []).filter((r) => r.include);
    if (chosen.length === 0) return;
    setSaving(true);
    try {
      const games = chosen.map(gameFromSteam);
      onAdd(games);
      await enrich(games);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  /** One game, added by the store link or app id that was pasted. */
  const addPasted = async () => {
    const appId = Number(/\d{3,}/.exec(manual)?.[0] ?? 0);
    if (!appId) {
      setError('That does not look like a Steam app id. The number in a store page URL is the one to paste.');
      return;
    }
    setSaving(true);
    try {
      // The store page brings the real name, so the placeholder never sticks.
      const meta = fetchMeta ? await fetchMetadata('', appId).catch(() => null) : null;
      const title = meta?.name || `Steam app ${appId}`;
      const game: Game = {
        ...gameFromSteam({ appId, name: title, installDir: '', sizeBytes: 0, lastPlayed: null, library: '' }),
        title,
        meta: meta ?? undefined,
      };
      onAdd([game]);
      if (fetchMeta) await enrich([game]);
      setManual('');
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const visible = (rows ?? []).filter((r) => !filter || r.name.toLowerCase().includes(filter.toLowerCase()));
  const chosen = (rows ?? []).filter((r) => r.include);

  return (
    <Modal
      title="Import from Steam"
      subtitle="Orbit reads the Steam library on this PC. Nothing is added until you pick it."
      size="xl"
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted">
            {chosen.length} of {rows?.length ?? 0} selected
            {chosen.length > 0 && ` · ${fmtBytes(chosen.reduce((s, r) => s + r.sizeBytes, 0))}`}
          </span>
          <div className="flex gap-2">
            <button className={`${btnGhost} flex items-center gap-2`} onClick={onClose} disabled={saving}>
              <X className="size-4" />
              Cancel
            </button>
            <button
              className={`${btnPrimary} flex items-center gap-2`}
              onClick={() => void addSelected()}
              disabled={chosen.length === 0 || saving}
            >
              {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
              {saving ? 'Adding…' : `Add ${chosen.length || ''} ${chosen.length === 1 ? 'game' : 'games'}`}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {!isNative() && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            The browser preview cannot see this PC's Steam library. Run Orbit as the desktop app to import from it.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <SearchField
            value={filter}
            onChange={setFilter}
            placeholder="Filter by name"
            className="min-w-[12rem] flex-1"
            inputClassName="w-full"
          />
          <button className={`${btnGhost} flex items-center gap-2`} onClick={() => void scan()} disabled={busy}>
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            {busy ? 'Reading Steam…' : 'Scan Steam library'}
          </button>
        </div>

        {error && <p className="rounded-lg border border-line bg-panel2/50 px-3 py-2 text-xs text-muted">{error}</p>}

        {(rows?.length ?? 0) > 0 && (
          <ul className="max-h-[20rem] space-y-1 overflow-y-auto pr-1">
            {visible.map((r) => {
              const known = byId.includes(r.appId) || byTitle.includes(r.name.trim().toLowerCase());
              return (
                <li key={r.appId}>
                  <div
                    className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${
                      known ? 'border-line bg-panel2/20' : 'border-line bg-panel2/40 hover:border-accent/60'
                    }`}
                  >
                    <CheckboxBox
                      checked={r.include}
                      onChange={() => toggle(r.appId)}
                      disabled={known}
                      title={known ? 'Already in the library' : r.name}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{r.name}</p>
                      <p className="truncate font-mono text-[11px] text-muted">
                        {known ? 'already in the library' : r.installDir || r.library || `app ${r.appId}`}
                      </p>
                    </div>
                    <div className="shrink-0 text-right text-xs text-muted">
                      <p>{fmtBytes(r.sizeBytes)}</p>
                      <p className="text-[10px]">
                        {r.lastPlayed ? `played ${fmtDate(new Date(r.lastPlayed * 1000).toISOString())}` : 'never played'}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
            {visible.length === 0 && <li className="px-3 py-2 text-sm text-muted">Nothing matches that name.</li>}
          </ul>
        )}

        <section className="space-y-2 rounded-xl border border-line bg-panel2/40 p-3">
          <h3 className="text-sm font-semibold">Add one by hand</h3>
          <p className="text-xs text-muted">
            Paste a Steam store link or an app id for a game that is in your Steam account but not installed here.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              className={`${inputCls} min-w-[12rem] flex-1`}
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="https://store.steampowered.com/app/620/… or 620"
              spellCheck={false}
            />
            <button
              className={`${btnGhost} flex items-center gap-2`}
              onClick={() => void addPasted()}
              disabled={!manual.trim() || saving}
            >
              <Download className="size-4" />
              Add this game
            </button>
          </div>
        </section>

        {fromSteam.length > 0 && (
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-400/30 bg-rose-500/5 p-3">
            <div>
              <h3 className="text-sm font-semibold">Steam games in your library</h3>
              <p className="text-xs text-muted">
                {fromSteam.length} {fromSteam.length === 1 ? 'game came' : 'games came'} in from Steam. Removing them
                takes their sessions and notes with them, and never touches the games on disk.
              </p>
            </div>
            <button
              onClick={onRemoveSteam}
              className="flex shrink-0 items-center gap-2 rounded-lg border border-rose-400/50 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10"
            >
              <Trash2 className="size-3.5" />
              Remove them all
            </button>
          </section>
        )}

        <p className="text-[11px] text-muted">
          A game added this way starts through Steam, because that is the only way it will start. Use Settings to have
          Orbit check this library for new games each time it launches.
        </p>
      </div>
    </Modal>
  );
}

/**
 * A Steam game as a row Orbit can store.
 *
 * The launch target is `steam`, which the launch editor never offers: a game
 * brought in this way has to go through Steam to start, so Orbit hands it over
 * rather than guessing at an .exe inside the install folder.
 */
export function gameFromSteam(r: SteamGame): Game {
  const sizeBytes = r.sizeBytes || 0;
  return {
    id: uid(),
    title: r.name,
    launch: { kind: 'steam', appId: r.appId },
    exePath: null,
    installDir: r.installDir || null,
    drive: r.installDir.slice(0, 2).toUpperCase(),
    sizeBytes,
    sizeGb: Math.round((sizeBytes / 1e9) * 10) / 10,
    status: 'backlog',
    favorite: false,
    manualPlaySecs: 0,
    playMinutes: 0,
    lastPlayed: null,
    addedAt: new Date().toISOString(),
    notes: '',
    hue: hashHue(r.name),
    coverPath: null,
    meta: {
      summary: '',
      genres: [],
      developer: '',
      releaseYear: null,
      rating: null,
      steamAppId: r.appId,
      source: 'steam',
    },
    sessionCount: 0,
    longestSecs: 0,
    running: false,
    companions: [],
  };
}

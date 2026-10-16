import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Cloud, CloudDownload, CloudUpload, ExternalLink, LoaderCircle } from 'lucide-react';
import type { Game, Settings } from '../../types';
import { openExternal } from '../../services/desktop';
import { CheckboxInline } from '../ui/Checkbox';
import { btnAccent } from '../ui/buttons';
import { inputCls, Modal } from '../ui/Modal';
import { cn } from '../../utils/cn';
import {
  cloudAdopt,
  cloudAttach,
  cloudConnect,
  cloudCopy,
  cloudDropNext,
  cloudFetch,
  cloudForget,
  cloudGameOf,
  cloudMove,
  cloudPage,
  cloudPending,
  cloudRemotes,
  cloudStatus,
  cloudTransfer,
  backupSave,
  isNative,
  saveHintsOf,
  savePlaceOf,
} from '../../services/native';

const OAUTH = [
  { id: 'drive', label: 'Google Drive' },
  { id: 'onedrive', label: 'OneDrive' },
  { id: 'dropbox', label: 'Dropbox' },
  { id: 'box', label: 'Box' },
] as const;

const SERVERS = [
  { id: 'ftp', label: 'FTP' },
  { id: 'sftp', label: 'SFTP' },
  { id: 'smb', label: 'SMB' },
  { id: 'webdav', label: 'WebDAV' },
] as const;

type CloudSettings = NonNullable<NonNullable<Settings['saves']>['cloud']>;
type Waiting = { provider: string; remote: string; own: boolean };

/**
 * A button on Saves that opens rclone on its own.
 *
 * The copies stay on this PC either way. rclone is only used to send those
 * copies. One already on this PC is used as it is. Otherwise Orbit keeps its
 * own copy in its folder, which is not a system install. A local backup never
 * asks for rclone.
 */
export function CloudPanel({
  settings,
  setSettings,
  games = [],
  embedded = false,
}: {
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => void;
  /** When set, a manual cloud backup makes the local copies first, then sends them. */
  games?: Game[];
  /** Drawn in place, for the Backups section, rather than behind a button. */
  embedded?: boolean;
}) {
  const cloud = settings.saves?.cloud;
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState<boolean | null>(null);
  const [placed, setPlaced] = useState(false);
  const [folder, setFolder] = useState('');
  const [version, setVersion] = useState('');
  const [update, setUpdate] = useState(false);
  const [latest, setLatest] = useState('');
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [server, setServer] = useState<(typeof SERVERS)[number]['id'] | null>(null);
  const [host, setHost] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [url, setUrl] = useState('');
  const [remotes, setRemotes] = useState<string[] | null>(null);
  const [path, setPath] = useState(cloud?.folder ?? '');
  const [page, setPage] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const [gameQuery, setGameQuery] = useState('');
  const [copyServer, setCopyServer] = useState<(typeof SERVERS)[number]['id'] | null>(null);
  const skip = new Set(cloud?.skip ?? []);
  const choosable = [...games].sort((a, b) => a.title.localeCompare(b.title));
  const query = gameQuery.trim().toLowerCase();
  const shown = choosable.filter((game) => !query || game.title.toLowerCase().includes(query));
  const chosen = choosable.filter((game) => !skip.has(game.id));

  const refresh = () => {
    if (!isNative()) {
      setReady(false);
      return;
    }
    void cloudStatus()
      .then((status) => {
        setReady(status.ready);
        setPlaced(status.placed);
        setFolder(status.folder ?? '');
        setVersion(status.version);
        setUpdate(!!status.update);
        setLatest(status.latest ?? '');
      })
      .catch(() => setReady(false));
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    setPath(cloud?.folder ?? '');
  }, [cloud?.folder, cloud?.remote]);

  useEffect(() => {
    if (!isNative() || !cloud?.remote) {
      setPage(null);
      return;
    }
    let live = true;
    void cloudPage(cloud.remote, !!cloud.own, cloud.provider || '')
      .then((url) => {
        if (live) setPage(url);
      })
      .catch(() => {
        if (live) setPage(null);
      });
    return () => {
      live = false;
    };
  }, [cloud?.remote, cloud?.own, cloud?.provider]);

  useEffect(() => {
    if (!isNative()) return;
    let live = true;
    void cloudPending()
      .then((label) => {
        if (live && label) setWaiting((current) => current ?? { provider: label, remote: 'orbit-next', own: false });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!isNative()) return;
    let stop: (() => void) | undefined;
    void listen<{ url?: string; opened?: boolean } | string>('cloud-auth', (event) => {
      const payload = event.payload;
      const url = typeof payload === 'string' ? payload : payload.url;
      if (!url) return;
      setAuthUrl(url);
      if (typeof payload === 'string' || payload.opened === false) void openExternal(url);
    }).then((unlisten) => {
      stop = unlisten;
    }).catch(() => {});
    return () => stop?.();
  }, []);

  const saveCloud = (next: CloudSettings | undefined) => {
    const saves = { ...(settings.saves ?? {}) } as NonNullable<Settings['saves']> & { syncTo?: string };
    delete saves.syncTo;
    setSettings({ saves: { ...saves, cloud: next } });
  };
  const withCloud = (next: CloudSettings): CloudSettings => ({
    auto: cloud?.auto,
    folder: cloud?.folder,
    skip: cloud?.skip,
    ...next,
  });

  const fail = (e: unknown) => setError(String(e).replace(/^Error:\s*/, ''));

  const getRclone = async (replace = false) => {
    setBusy(replace ? 'update' : 'fetch');
    setError(null);
    setNote(null);
    try {
      setNote(await cloudFetch(replace));
      const status = await cloudStatus();
      setReady(status.ready);
      setPlaced(status.placed);
      setFolder(status.folder ?? '');
      setVersion(status.version);
      setUpdate(!!status.update);
      setLatest(status.latest ?? '');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const backupToCloud = async () => {
    if (!cloud?.remote) {
      setError('Sign in first.');
      return;
    }
    if (chosen.length === 0) {
      setError('Choose at least one game.');
      return;
    }
    setBusy('up');
    setError(null);
    setNote(null);
    try {
      let copied = 0;
      for (const game of chosen) {
        try {
          await backupSave(game.id, game.title, settings.saves?.dirs?.[game.id] ?? null, saveHintsOf(game), savePlaceOf(game, settings));
          copied += 1;
        } catch {
          // A game with no save folder is skipped. The others still go up.
        }
      }
      const sent = await cloudCopy(true, cloud.remote, !!cloud.own, settings.saves?.backupRoot, cloud.folder, chosen.map(cloudGameOf));
      setNote(chosen.length > 0 && copied === 0 ? `${sent} No new save folder was copied first.` : sent);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const setAuto = (auto: boolean) => {
    saveCloud(withCloud({
      remote: cloud?.remote ?? '',
      provider: cloud?.provider ?? '',
      own: cloud?.own ?? false,
      auto,
    }));
  };

  const setSkipped = (id: string, skipped: boolean) => {
    const next = new Set(cloud?.skip ?? []);
    if (skipped) next.add(id);
    else next.delete(id);
    saveCloud(withCloud({
      remote: cloud?.remote ?? '',
      provider: cloud?.provider ?? '',
      own: cloud?.own ?? false,
      skip: [...next],
    }));
  };

  const setVisible = (on: boolean) => {
    const next = new Set(cloud?.skip ?? []);
    for (const game of shown) {
      if (on) next.delete(game.id);
      else next.add(game.id);
    }
    saveCloud(withCloud({
      remote: cloud?.remote ?? '',
      provider: cloud?.provider ?? '',
      own: cloud?.own ?? false,
      skip: [...next],
    }));
  };

  const connect = async (provider: string) => {
    setBusy(provider);
    setError(null);
    setNote(null);
    setAuthUrl(null);
    try {
      const label = await cloudConnect(provider, { host, user, password, url, folder: cloud?.folder });
      setPassword('');
      saveCloud(withCloud({
        remote: 'orbit',
        provider: label,
        own: false,
        auto: cloud?.auto ?? false,
      }));
      setNote(`Connected to ${label}.`);
      setServer(null);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const loadRemotes = async () => {
    setBusy('remotes');
    setError(null);
    try {
      setRemotes(await cloudRemotes());
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const useRemote = async (remote: string) => {
    setBusy(remote);
    setError(null);
    setNote(null);
    try {
      await cloudAttach(remote, cloud?.folder);
      saveCloud(withCloud({
        remote,
        provider: remote,
        own: true,
        auto: cloud?.auto ?? false,
      }));
      setNote(`Using ${remote}. Forgetting it here does not remove it from rclone.`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const send = async (up: boolean) => {
    if (!cloud?.remote) return;
    if (up && chosen.length === 0) {
      setError('Choose at least one game.');
      return;
    }
    setBusy(up ? 'up' : 'down');
    setError(null);
    setNote(null);
    try {
      setNote(await cloudCopy(
        up,
        cloud.remote,
        !!cloud.own,
        settings.saves?.backupRoot,
        cloud.folder,
        up ? chosen.map(cloudGameOf) : null,
      ));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const forget = async () => {
    setBusy('forget');
    setError(null);
    setNote(null);
    try {
      if (cloud && !cloud.own) await cloudForget();
      setWaiting(null);
      saveCloud(undefined);
      setNote(cloud?.own ? 'Signed out of that remote. It is still in rclone.' : 'Signed out.');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const moveFolder = async () => {
    if (!cloud?.remote) return;
    setBusy('move');
    setError(null);
    setNote(null);
    try {
      const from = cloud.folder?.trim() || 'Orbit';
      const to = path.trim() || 'Orbit';
      const sent = await cloudMove(cloud.remote, !!cloud.own, from, to);
      saveCloud(withCloud({
        remote: cloud.remote,
        provider: cloud.provider,
        own: cloud.own,
        folder: to === 'Orbit' ? undefined : to,
      }));
      setNote(sent);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const copyTo = async (provider: string) => {
    if (!cloud?.remote) return;
    setBusy(`copy-${provider}`);
    setError(null);
    setNote(null);
    setAuthUrl(null);
    let label = '';
    try {
      label = await cloudConnect(provider, { host, user, password, url, extra: true, folder: cloud.folder });
      setPassword('');
    } catch (e) {
      fail(e);
      setBusy(null);
      return;
    }
    try {
      const sent = await cloudTransfer(cloud.remote, !!cloud.own, 'orbit-next', false, cloud.folder);
      setWaiting({ provider: label, remote: 'orbit-next', own: false });
      setNote(`${sent} Use ${label} from now on, or keep this cloud.`);
      setCopyServer(null);
    } catch (e) {
      setWaiting({ provider: label, remote: 'orbit-next', own: false });
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const copyToRemote = async (remote: string) => {
    if (!cloud?.remote) return;
    setBusy(remote);
    setError(null);
    setNote(null);
    try {
      const sent = await cloudTransfer(cloud.remote, !!cloud.own, remote, true, cloud.folder);
      setWaiting({ provider: remote, remote, own: true });
      setNote(`${sent} Use ${remote} from now on, or keep this cloud.`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const retryTransfer = async () => {
    if (!cloud?.remote || !waiting) return;
    setBusy('transfer');
    setError(null);
    try {
      const sent = await cloudTransfer(cloud.remote, !!cloud.own, waiting.remote, waiting.own, cloud.folder);
      setNote(`${sent} Use ${waiting.provider} from now on, or keep this cloud.`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const useWaiting = async () => {
    if (!waiting || !cloud) return;
    setBusy('adopt');
    setError(null);
    try {
      if (waiting.own) {
        saveCloud(withCloud({
          remote: waiting.remote,
          provider: waiting.provider,
          own: true,
        }));
        setNote(`Using ${waiting.provider}.`);
      } else {
        const label = await cloudAdopt();
        saveCloud(withCloud({
          remote: 'orbit',
          provider: label || waiting.provider,
          own: false,
        }));
        setNote(`Using ${label || waiting.provider}.`);
      }
      setWaiting(null);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const keepCurrent = async () => {
    setBusy('drop');
    setError(null);
    try {
      if (waiting && !waiting.own) await cloudDropNext();
      setWaiting(null);
      setNote(`Keeping ${cloud?.provider || 'this cloud'}.`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const where = !ready
    ? 'Not here yet'
    : placed
      ? "Orbit's copy"
      : 'Already on this PC';
  const automatic = !!cloud?.auto;

  const controls = (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-fg">
                {ready === null ? 'Looking for rclone…' : `${where}${version ? ` · ${version}` : ''}`}
              </p>
              <div className="flex flex-wrap gap-2">
                {(ready === false || (ready && !placed)) && (
                  <button
                    type="button"
                    disabled={!isNative() || busy !== null}
                    onClick={() => void getRclone(false)}
                    className={cn(btnAccent, 'rounded-lg px-3 py-1.5 text-xs disabled:opacity-50')}
                  >
                    {busy === 'fetch' ? 'Getting rclone…' : ready ? 'Keep a copy in Orbit' : 'Get rclone'}
                  </button>
                )}
                {placed && update && (
                  <button
                    type="button"
                    disabled={!isNative() || busy !== null}
                    onClick={() => void getRclone(true)}
                    title={latest ? `The current release is ${latest}` : 'A newer rclone is out'}
                    className="rounded-lg border border-line px-3 py-1.5 text-xs text-fg hover:border-accent disabled:opacity-50"
                  >
                    {busy === 'update' ? 'Updating…' : 'Update rclone'}
                  </button>
                )}
              </div>
            </div>
            <p className="text-xs text-muted">
              If rclone is already on this PC, that one is used. Otherwise Orbit keeps its own copy in its folder. Neither is a system install. Update only shows when a newer release is out.
            </p>
            {folder && (
              <p className="break-all font-mono text-[11px] text-muted" title="Where Orbit keeps rclone">
                {folder}
                {placed ? '' : ready ? ' · not the copy being used' : ''}
              </p>
            )}

            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted">Sync</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <button
                  type="button"
                  aria-pressed={!automatic}
                  onClick={() => setAuto(false)}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-xs',
                    !automatic ? 'border-accent text-fg' : 'border-line text-muted hover:border-accent hover:text-fg',
                  )}
                >
                  Manual
                </button>
                <button
                  type="button"
                  aria-pressed={automatic}
                  onClick={() => setAuto(true)}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-xs',
                    automatic ? 'border-accent text-fg' : 'border-line text-muted hover:border-accent hover:text-fg',
                  )}
                >
                  After a backup
                </button>
              </div>
              <p className="mt-1 text-[11px] text-muted">
                {automatic
                  ? 'A finished backup of a ticked game is sent up. You can still send a game yourself.'
                  : 'Nothing is sent on its own. Back up to the cloud when you want the ticked games sent.'}
              </p>
              <div className="mt-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] uppercase tracking-widest text-muted">Games</p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setVisible(true)} className="text-[11px] text-muted hover:text-fg">All</button>
                    <button type="button" onClick={() => setVisible(false)} className="text-[11px] text-muted hover:text-fg">None</button>
                  </div>
                </div>
                {choosable.length > 8 && (
                  <input
                    className={cn(inputCls, 'mt-1.5')}
                    value={gameQuery}
                    onChange={(e) => setGameQuery(e.target.value)}
                    placeholder="Find a game"
                    spellCheck={false}
                  />
                )}
                <ul className="mt-1.5 max-h-48 space-y-1 overflow-y-auto">
                  {shown.length === 0 && <li className="text-[11px] text-muted">{choosable.length === 0 ? 'No games yet.' : 'No match.'}</li>}
                  {shown.map((game) => (
                    <li key={game.id}>
                      <CheckboxInline
                        checked={!skip.has(game.id)}
                        onChange={(on) => setSkipped(game.id, !on)}
                        label={game.title}
                      />
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-[11px] text-muted">Unticked games stay on this PC. A game can still be sent from Saves.</p>
              </div>
              <button
                type="button"
                disabled={!isNative() || !cloud?.remote || busy !== null || chosen.length === 0}
                onClick={() => void backupToCloud()}
                title={!cloud?.remote ? 'Sign in first' : chosen.length === 0 ? 'Tick a game first' : 'Make the copies, then send the ticked games'}
                className={cn(btnAccent, 'mt-2 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs disabled:opacity-50')}
              >
                {busy === 'up' ? <LoaderCircle className="size-3.5 animate-spin" /> : <CloudUpload className="size-3.5" />}
                {busy === 'up' ? 'Backing up…' : 'Back up to the cloud'}
              </button>
            </div>

            {!isNative() && <p className="text-xs text-muted">Cloud copies need the desktop app.</p>}

            {cloud?.remote ? (
              <div className="space-y-3 rounded-xl border border-line bg-panel2/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{cloud.provider || cloud.remote}</p>
                  {page && (
                    <button
                      type="button"
                      onClick={() => void openExternal(page)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-fg hover:border-accent"
                    >
                      <ExternalLink className="size-3.5" />
                      {cloud.provider && OAUTH.some((item) => item.label === cloud.provider) ? `Open ${cloud.provider}` : 'Open in the browser'}
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void send(true)}
                    className={cn(btnAccent, 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs disabled:opacity-50')}
                  >
                    {busy === 'up' ? <LoaderCircle className="size-3.5 animate-spin" /> : <CloudUpload className="size-3.5" />}
                    Send
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void send(false)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-fg hover:border-accent disabled:opacity-50"
                  >
                    {busy === 'down' ? <LoaderCircle className="size-3.5 animate-spin" /> : <CloudDownload className="size-3.5" />}
                    Bring down
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void forget()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:border-rose-400/60 hover:text-rose-300 disabled:opacity-50"
                  >
                    Forget
                  </button>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-widest text-muted">Folder on this cloud</p>
                  <p className="mt-1 text-[11px] text-muted">Now: {cloud.folder?.trim() || 'Orbit'}</p>
                  <div className="mt-1.5 flex gap-2">
                    <input
                      className={inputCls}
                      value={path}
                      onChange={(e) => setPath(e.target.value)}
                      placeholder="Orbit"
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void moveFolder()}
                      className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs text-fg hover:border-accent disabled:opacity-50"
                    >
                      {busy === 'move' ? 'Moving…' : 'Move'}
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] text-muted">Moves the copies already on this cloud. The next backup uses that path.</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-widest text-muted">Another cloud</p>
                  <p className="mt-1 text-[11px] text-muted">Copy the copies already on this cloud. This sign-in stays until you switch.</p>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {OAUTH.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        disabled={!isNative() || !ready || busy !== null}
                        onClick={() => void copyTo(item.id)}
                        className="rounded-lg border border-line px-3 py-1.5 text-xs text-fg hover:border-accent disabled:opacity-50"
                      >
                        {busy === `copy-${item.id}` ? 'Copying…' : item.label}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {SERVERS.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        disabled={!isNative() || !ready || busy !== null}
                        onClick={() => setCopyServer(item.id)}
                        className={cn(
                          'rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50',
                          copyServer === item.id ? 'border-accent text-fg' : 'border-line text-muted hover:border-accent hover:text-fg',
                        )}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  {copyServer && (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {copyServer === 'webdav' ? (
                        <label className="sm:col-span-2">
                          <span className="mb-1 block text-[11px] text-muted">Address</span>
                          <input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://cloud.example/remote.php/dav/files/you/" spellCheck={false} />
                        </label>
                      ) : (
                        <label className="sm:col-span-2">
                          <span className="mb-1 block text-[11px] text-muted">Host</span>
                          <input className={inputCls} value={host} onChange={(e) => setHost(e.target.value)} placeholder="host" spellCheck={false} />
                        </label>
                      )}
                      <label>
                        <span className="mb-1 block text-[11px] text-muted">User</span>
                        <input className={inputCls} value={user} onChange={(e) => setUser(e.target.value)} spellCheck={false} />
                      </label>
                      <label>
                        <span className="mb-1 block text-[11px] text-muted">Password</span>
                        <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                      </label>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void copyTo(copyServer)}
                        className={cn(btnAccent, 'rounded-lg px-3 py-1.5 text-xs disabled:opacity-50 sm:col-span-2 sm:justify-self-start')}
                      >
                        {busy === `copy-${copyServer}` ? 'Copying…' : 'Copy to this server'}
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    disabled={!isNative() || !ready || busy !== null}
                    onClick={() => void loadRemotes()}
                    className="mt-2 block text-xs text-muted underline-offset-2 hover:text-fg hover:underline disabled:opacity-50"
                  >
                    {busy === 'remotes' ? 'Looking…' : 'A remote rclone already has'}
                  </button>
                  {remotes && (
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {remotes.filter((remote) => !(cloud.own && remote === cloud.remote)).length === 0 && (
                        <p className="text-[11px] text-muted">None.</p>
                      )}
                      {remotes
                        .filter((remote) => !(cloud.own && remote === cloud.remote))
                        .map((remote) => (
                          <button
                            key={remote}
                            type="button"
                            disabled={busy !== null}
                            onClick={() => void copyToRemote(remote)}
                            className="rounded-lg border border-line px-3 py-1.5 text-xs text-fg hover:border-accent disabled:opacity-50"
                          >
                            {busy === remote ? 'Copying…' : remote}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
                {waiting && (
                  <div className="rounded-lg border border-line p-2">
                    <p className="text-xs text-fg">The copies are also on {waiting.provider}.</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void useWaiting()}
                        className={cn(btnAccent, 'rounded-lg px-3 py-1.5 text-xs disabled:opacity-50')}
                      >
                        {busy === 'adopt' ? 'Switching…' : `Use ${waiting.provider}`}
                      </button>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void retryTransfer()}
                        className="rounded-lg border border-line px-3 py-1.5 text-xs text-fg hover:border-accent disabled:opacity-50"
                      >
                        {busy === 'transfer' ? 'Copying…' : 'Try the copy again'}
                      </button>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void keepCurrent()}
                        className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:border-accent hover:text-fg disabled:opacity-50"
                      >
                        {busy === 'drop' ? 'Keeping…' : `Keep ${cloud.provider || 'this cloud'}`}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-[11px] uppercase tracking-widest text-muted">Sign in</p>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {OAUTH.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        disabled={!isNative() || !ready || busy !== null}
                        onClick={() => void connect(item.id)}
                        className="rounded-lg border border-line px-3 py-1.5 text-xs text-fg hover:border-accent disabled:opacity-50"
                      >
                        {busy === item.id ? 'Waiting for the sign-in…' : item.label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] text-muted">A work OneDrive has to be a remote rclone already has.</p>
                </div>

                <div>
                  <p className="text-[11px] uppercase tracking-widest text-muted">A server</p>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {SERVERS.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        disabled={!isNative() || !ready || busy !== null}
                        onClick={() => setServer(item.id)}
                        className={cn(
                          'rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50',
                          server === item.id ? 'border-accent text-fg' : 'border-line text-muted hover:border-accent hover:text-fg',
                        )}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  {server && (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {server === 'webdav' ? (
                        <label className="sm:col-span-2">
                          <span className="mb-1 block text-[11px] text-muted">Address</span>
                          <input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://cloud.example/remote.php/dav/files/you/" spellCheck={false} />
                        </label>
                      ) : (
                        <label className="sm:col-span-2">
                          <span className="mb-1 block text-[11px] text-muted">Host</span>
                          <input className={inputCls} value={host} onChange={(e) => setHost(e.target.value)} placeholder="host" spellCheck={false} />
                        </label>
                      )}
                      <label>
                        <span className="mb-1 block text-[11px] text-muted">User</span>
                        <input className={inputCls} value={user} onChange={(e) => setUser(e.target.value)} spellCheck={false} />
                      </label>
                      <label>
                        <span className="mb-1 block text-[11px] text-muted">Password</span>
                        <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                      </label>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void connect(server)}
                        className={cn(btnAccent, 'rounded-lg px-3 py-1.5 text-xs disabled:opacity-50 sm:col-span-2 sm:justify-self-start')}
                      >
                        {busy === server ? 'Connecting…' : 'Connect'}
                      </button>
                    </div>
                  )}
                </div>

                <div>
                  <button
                    type="button"
                    disabled={!isNative() || !ready || busy !== null}
                    onClick={() => void loadRemotes()}
                    className="text-xs text-muted underline-offset-2 hover:text-fg hover:underline disabled:opacity-50"
                  >
                    {busy === 'remotes' ? 'Looking…' : 'Remotes rclone already has'}
                  </button>
                  {remotes && (
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {remotes.length === 0 && <p className="text-[11px] text-muted">None.</p>}
                      {remotes.map((remote) => (
                        <button
                          key={remote}
                          type="button"
                          disabled={busy !== null}
                          onClick={() => void useRemote(remote)}
                          className="rounded-lg border border-line px-3 py-1.5 text-xs text-fg hover:border-accent disabled:opacity-50"
                        >
                          {busy === remote ? 'Using…' : remote}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {authUrl && (
              <p className="text-xs text-muted">
                The sign-in page should be open. If it is not,{' '}
                <button
                  type="button"
                  onClick={() => void openExternal(authUrl)}
                  className="text-accent underline-offset-2 hover:underline"
                >
                  open it again
                </button>
                .
              </p>
            )}
            {note && <p className="text-xs text-fg">{note}</p>}
            {error && <p className="text-xs text-rose-300">{error}</p>}
          </div>
  );

  if (embedded) return controls;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          refresh();
        }}
        className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm text-muted hover:border-accent hover:text-fg"
      >
        <Cloud className="size-4" />
        Cloud
      </button>

      {open && (
        <Modal
          title="Cloud"
          subtitle="Sends the copies already on this PC. A local backup installs nothing."
          size="lg"
          onClose={() => setOpen(false)}
        >
          {controls}
        </Modal>
      )}
    </>
  );
}

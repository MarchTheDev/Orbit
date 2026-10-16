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
  cloudAttach,
  cloudAccounts,
  cloudAutoOn,
  cloudConnect,
  cloudCopy,
  cloudFetch,
  cloudForget,
  cloudGameOf,
  cloudMove,
  cloudPage,
  cloudRemotes,
  cloudSkipOf,
  cloudStatus,
  cloudTransfer,
  freshRemote,
  savesWithClouds,
  sendToClouds,
  backupSave,
  isNative,
  saveHintsOf,
  savePlaceOf,
  type CloudAccount,
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

/**
 * Connected clouds, and nothing else.
 *
 * Signing in and choosing games stays on Saves. This is only the list, and
 * the way to disconnect one.
 */
export function CloudAccounts({
  settings,
  setSettings,
}: {
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => void;
}) {
  const accounts = cloudAccounts(settings.saves);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const disconnect = async (account: CloudAccount) => {
    setBusy(account.remote);
    setError(null);
    try {
      if (!account.own) await cloudForget(account.remote);
      setSettings({
        saves: savesWithClouds(settings.saves, {
          clouds: accounts.filter((item) => item.remote !== account.remote),
        }),
      });
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ''));
    } finally {
      setBusy(null);
    }
  };

  if (accounts.length === 0) {
    return <p className="text-sm text-muted">None yet. Add one from Saves, under Cloud.</p>;
  }

  return (
    <div className="space-y-2">
      {accounts.map((account) => (
        <div key={account.remote} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-panel/50 px-3 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{account.provider || account.remote}</p>
            {account.own && <p className="truncate text-[11px] text-muted">A remote rclone already had</p>}
          </div>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void disconnect(account)}
            className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:border-rose-400/60 hover:text-rose-300 disabled:opacity-50"
          >
            {busy === account.remote ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </div>
      ))}
      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  );
}

/**
 * The cloud page on Saves.
 *
 * Several clouds can stay connected. A backup goes to the ones marked, or to
 * all of them. Only games with a save folder are listed.
 */
export function CloudPanel({
  settings,
  setSettings,
  games = [],
}: {
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => void;
  games?: Game[];
}) {
  const accounts = cloudAccounts(settings.saves);
  const auto = cloudAutoOn(settings.saves);
  const skip = new Set(cloudSkipOf(settings.saves));
  const dirs = settings.saves?.dirs ?? {};
  const known = [...games]
    .filter((game) => !!dirs[game.id]?.trim())
    .sort((a, b) => a.title.localeCompare(b.title));
  const chosen = known.filter((game) => !skip.has(game.id));

  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState<boolean | null>(null);
  const [placed, setPlaced] = useState(false);
  const [rcloneFolder, setRcloneFolder] = useState('');
  const [version, setVersion] = useState('');
  const [update, setUpdate] = useState(false);
  const [latest, setLatest] = useState('');
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [server, setServer] = useState<(typeof SERVERS)[number]['id'] | null>(null);
  const [showServers, setShowServers] = useState(false);
  const [host, setHost] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [url, setUrl] = useState('');
  const [remotes, setRemotes] = useState<string[] | null>(null);
  const [gameQuery, setGameQuery] = useState('');

  const refresh = () => {
    if (!isNative()) {
      setReady(false);
      return;
    }
    void cloudStatus()
      .then((status) => {
        setReady(status.ready);
        setPlaced(status.placed);
        setRcloneFolder(status.folder ?? '');
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
    if (!isNative()) return;
    let stop: (() => void) | undefined;
    void listen<{ url?: string; opened?: boolean } | string>('cloud-auth', (event) => {
      const payload = event.payload;
      const link = typeof payload === 'string' ? payload : payload.url;
      if (!link) return;
      setAuthUrl(link);
      if (typeof payload === 'string' || payload.opened === false) void openExternal(link);
    }).then((unlisten) => {
      stop = unlisten;
    }).catch(() => {});
    return () => stop?.();
  }, []);

  const write = (patch: { clouds?: CloudAccount[]; cloudAuto?: boolean; cloudSkip?: string[] }) => {
    setSettings({ saves: savesWithClouds(settings.saves, patch) });
  };

  const fail = (e: unknown) => setError(String(e).replace(/^Error:\s*/, ''));

  const getRclone = async (replace = false) => {
    setBusy(replace ? 'update' : 'fetch');
    setError(null);
    setNote(null);
    try {
      setNote(await cloudFetch(replace));
      refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const connect = async (provider: string) => {
    setBusy(provider);
    setError(null);
    setNote(null);
    setAuthUrl(null);
    const used = new Set(accounts.map((item) => item.remote));
    let name = freshRemote();
    while (used.has(name)) name = freshRemote();
    try {
      const label = await cloudConnect(provider, { host, user, password, url, name });
      setPassword('');
      write({
        clouds: [...accounts, { remote: name, provider: label, own: false, on: true }],
      });
      setNote(`Connected to ${label}.`);
      setServer(null);
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
      await cloudAttach(remote);
      const rest = accounts.filter((item) => item.remote !== remote);
      write({ clouds: [...rest, { remote, provider: remote, own: true, on: true }] });
      setNote(`Using ${remote}. Disconnecting it here does not remove it from rclone.`);
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

  const setIncluded = (remote: string, on: boolean) => {
    write({
      clouds: accounts.map((item) => (item.remote === remote ? { ...item, on } : item)),
    });
  };

  const setFolder = (remote: string, folder: string | undefined) => {
    write({
      clouds: accounts.map((item) => (item.remote === remote ? { ...item, folder } : item)),
    });
  };

  const setSkipped = (id: string, skipped: boolean) => {
    const next = new Set(cloudSkipOf(settings.saves));
    if (skipped) next.add(id);
    else next.delete(id);
    write({ cloudSkip: [...next] });
  };

  const setVisible = (on: boolean) => {
    const next = new Set(cloudSkipOf(settings.saves));
    for (const game of shown) {
      if (on) next.delete(game.id);
      else next.add(game.id);
    }
    write({ cloudSkip: [...next] });
  };

  const backup = async (which: 'chosen' | 'all') => {
    if (chosen.length === 0) {
      setError('Choose a game with a save folder.');
      return;
    }
    setBusy(which === 'all' ? 'all' : 'up');
    setError(null);
    setNote(null);
    try {
      for (const game of chosen) {
        try {
          await backupSave(game.id, game.title, dirs[game.id] ?? null, saveHintsOf(game), savePlaceOf(game, settings));
        } catch {
          // A game whose folder cannot be copied is left. The others still go.
        }
      }
      setNote(await sendToClouds(accounts, which, settings.saves?.backupRoot, chosen.map(cloudGameOf)));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const sendOne = async (account: CloudAccount, up: boolean) => {
    setBusy(up ? `send-${account.remote}` : `down-${account.remote}`);
    setError(null);
    setNote(null);
    try {
      if (!up) {
        setNote(await cloudCopy(false, account.remote, account.own, settings.saves?.backupRoot, account.folder));
        return;
      }
      if (chosen.length === 0) {
        setError('Choose a game with a save folder.');
        return;
      }
      setNote(await cloudCopy(true, account.remote, account.own, settings.saves?.backupRoot, account.folder, chosen.map(cloudGameOf)));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const copyFrom = async (from: CloudAccount, to: CloudAccount) => {
    setBusy(`copy-${to.remote}`);
    setError(null);
    setNote(null);
    try {
      setNote(await cloudTransfer(from.remote, from.own, to.remote, to.own, from.folder));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const query = gameQuery.trim().toLowerCase();
  const shown = known.filter((game) => !query || game.title.toLowerCase().includes(query));
  const where = !ready ? 'Looking for rclone…' : placed ? "Orbit's rclone" : ready ? 'rclone already on this PC' : 'rclone is not here yet';

  const controls = (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-fg">
          {where}{version ? ` · ${version}` : ''}
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
      {rcloneFolder && (
        <p className="break-all font-mono text-[11px] text-muted">{rcloneFolder}</p>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Clouds</h3>
        {accounts.length === 0 && <p className="text-xs text-muted">None connected. Add one below. Disconnect from Settings, under Backups.</p>}
        {accounts.map((account) => (
          <CloudCard
            key={account.remote}
            account={account}
            others={accounts.filter((item) => item.remote !== account.remote)}
            busy={busy}
            onIncluded={(on) => setIncluded(account.remote, on)}
            onFolder={(folder) => setFolder(account.remote, folder)}
            onSend={(up) => void sendOne(account, up)}
            onCopyFrom={(from) => void copyFrom(from, account)}
            fail={fail}
          />
        ))}
        {accounts.length > 0 && <p className="text-[11px] text-muted">Disconnect a cloud from Settings, under Backups.</p>}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Add a cloud</h3>
        <div className="flex flex-wrap gap-2">
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
        <p className="text-[11px] text-muted">A work OneDrive has to be a remote rclone already has.</p>
        <button
          type="button"
          onClick={() => {
            setShowServers((on) => !on);
            if (showServers) setServer(null);
          }}
          className="text-xs text-muted underline-offset-2 hover:text-fg hover:underline"
        >
          {showServers ? 'Hide servers' : 'A server'}
        </button>
        {showServers && (
        <>
        <div className="flex flex-wrap gap-2">
          {SERVERS.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={!isNative() || !ready || busy !== null}
              onClick={() => setServer(server === item.id ? null : item.id)}
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
          <div className="grid gap-2 sm:grid-cols-2">
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
        </>
        )}
        <button
          type="button"
          disabled={!isNative() || !ready || busy !== null}
          onClick={() => void loadRemotes()}
          className="text-xs text-muted underline-offset-2 hover:text-fg hover:underline disabled:opacity-50"
        >
          {busy === 'remotes' ? 'Looking…' : 'A remote rclone already has'}
        </button>
        {remotes && (
          <div className="flex flex-wrap gap-2">
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
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Games with a save folder</h3>
          {known.length > 0 && (
            <div className="flex gap-2">
              <button type="button" onClick={() => setVisible(true)} className="text-[11px] text-muted hover:text-fg">All</button>
              <button type="button" onClick={() => setVisible(false)} className="text-[11px] text-muted hover:text-fg">None</button>
            </div>
          )}
        </div>
        <p className="text-[11px] text-muted">Games with no save folder are left out. A game can still be sent from its row on Saves.</p>
        {known.length > 8 && (
          <input
            className={inputCls}
            value={gameQuery}
            onChange={(e) => setGameQuery(e.target.value)}
            placeholder="Find a game"
            spellCheck={false}
          />
        )}
        {known.length === 0 ? (
          <p className="text-xs text-muted">None yet. Orbit looks for save folders on its own.</p>
        ) : (
          <ul className="max-h-48 space-y-1 overflow-y-auto">
            {shown.length === 0 && <li className="text-[11px] text-muted">No match.</li>}
            {shown.map((game) => (
              <li key={game.id}>
                <CheckboxInline
                  checked={!skip.has(game.id)}
                  onChange={(on) => setSkipped(game.id, !on)}
                  label={
                    <span className="min-w-0">
                      <span className="block truncate">{game.title}</span>
                      <span className="block truncate text-[11px] text-muted">{dirs[game.id]}</span>
                    </span>
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <CheckboxInline
          checked={auto}
          onChange={(on) => write({ cloudAuto: on })}
          label="Also send after a backup, to the clouds that are marked"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!isNative() || accounts.length === 0 || chosen.length === 0 || busy !== null}
            onClick={() => void backup('chosen')}
            className={cn(btnAccent, 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs disabled:opacity-50')}
          >
            {busy === 'up' ? <LoaderCircle className="size-3.5 animate-spin" /> : <CloudUpload className="size-3.5" />}
            {busy === 'up' ? 'Backing up…' : 'Back up to marked clouds'}
          </button>
          {accounts.length > 1 && (
            <button
              type="button"
              disabled={!isNative() || chosen.length === 0 || busy !== null}
              onClick={() => void backup('all')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-fg hover:border-accent disabled:opacity-50"
            >
              {busy === 'all' ? <LoaderCircle className="size-3.5 animate-spin" /> : <CloudUpload className="size-3.5" />}
              {busy === 'all' ? 'Backing up…' : 'Back up to all clouds'}
            </button>
          )}
        </div>
      </section>

      {!isNative() && <p className="text-xs text-muted">Cloud copies need the desktop app.</p>}
      {authUrl && (
        <p className="text-xs text-muted">
          The sign-in page should be open. If it is not,{' '}
          <button type="button" onClick={() => void openExternal(authUrl)} className="text-accent underline-offset-2 hover:underline">
            open it again
          </button>
          .
        </p>
      )}
      {note && <p className="text-xs text-fg">{note}</p>}
      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  );

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
          subtitle="Several clouds can stay connected. Only games with a save folder are listed."
          size="lg"
          onClose={() => setOpen(false)}
        >
          {controls}
        </Modal>
      )}
    </>
  );
}

function CloudCard({
  account,
  others,
  busy,
  onIncluded,
  onFolder,
  onSend,
  onCopyFrom,
  fail,
}: {
  account: CloudAccount;
  others: CloudAccount[];
  busy: string | null;
  onIncluded: (on: boolean) => void;
  onFolder: (folder: string | undefined) => void;
  onSend: (up: boolean) => void;
  onCopyFrom: (from: CloudAccount) => void;
  fail: (e: unknown) => void;
}) {
  const [page, setPage] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [copying, setCopying] = useState(false);
  const [path, setPath] = useState(account.folder ?? '');
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    setPath(account.folder ?? '');
  }, [account.folder, account.remote]);

  useEffect(() => {
    if (!isNative()) return;
    let live = true;
    void cloudPage(account.remote, account.own, account.provider)
      .then((url) => {
        if (live) setPage(url);
      })
      .catch(() => {
        if (live) setPage(null);
      });
    return () => {
      live = false;
    };
  }, [account.remote, account.own, account.provider]);

  const move = async () => {
    setMoving(true);
    try {
      const from = account.folder?.trim() || 'Orbit';
      const to = path.trim() || 'Orbit';
      await cloudMove(account.remote, account.own, from, to);
      onFolder(to === 'Orbit' ? undefined : to);
      setEditing(false);
    } catch (e) {
      fail(e);
    } finally {
      setMoving(false);
    }
  };

  const known = OAUTH.some((item) => item.label === account.provider);

  return (
    <div className="space-y-2 rounded-xl border border-line bg-panel/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-medium">{account.provider || account.remote}</p>
        {page && (
          <button
            type="button"
            onClick={() => void openExternal(page)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs text-fg hover:border-accent"
          >
            <ExternalLink className="size-3.5" />
            {known ? `Open ${account.provider}` : 'Open in the browser'}
          </button>
        )}
      </div>
      <CheckboxInline
        checked={account.on !== false}
        onChange={onIncluded}
        label="Send backups here"
      />
      <div className="text-[11px] text-muted">
        <span>Folder: {account.folder?.trim() || 'Orbit'}</span>
        {!editing && (
          <button type="button" onClick={() => setEditing(true)} className="ml-2 text-fg underline-offset-2 hover:underline">
            Change
          </button>
        )}
      </div>
      {editing && (
        <div className="flex gap-2">
          <input
            className={inputCls}
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="Orbit"
            spellCheck={false}
          />
          <button
            type="button"
            disabled={busy !== null || moving}
            onClick={() => void move()}
            className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs text-fg hover:border-accent disabled:opacity-50"
          >
            {moving ? 'Moving…' : 'Move'}
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => onSend(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs text-fg hover:border-accent disabled:opacity-50"
        >
          {busy === `send-${account.remote}` ? <LoaderCircle className="size-3.5 animate-spin" /> : <CloudUpload className="size-3.5" />}
          Send
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => onSend(false)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-fg disabled:opacity-50"
        >
          {busy === `down-${account.remote}` ? <LoaderCircle className="size-3.5 animate-spin" /> : <CloudDownload className="size-3.5" />}
          Bring down
        </button>
        {others.length > 0 && (
          <button
            type="button"
            onClick={() => setCopying((on) => !on)}
            className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-fg"
          >
            Copy from another
          </button>
        )}
      </div>
      {copying && (
        <div className="flex flex-wrap gap-2">
          {others.map((other) => (
            <button
              key={other.remote}
              type="button"
              disabled={busy !== null}
              onClick={() => onCopyFrom(other)}
              className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-fg disabled:opacity-50"
            >
              {busy === `copy-${account.remote}` ? 'Copying…' : other.provider}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

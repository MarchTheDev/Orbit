import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { listen } from '@tauri-apps/api/event';
import { Cloud, CloudDownload, CloudUpload, ExternalLink, LoaderCircle } from 'lucide-react';
import type { Game, Settings } from '../../types';
import { openExternal } from '../../services/desktop';
import { CheckboxBox } from '../ui/Checkbox';
import { Cover } from '../ui/Cover';
import { ContextMenu, type MenuItem } from '../ui/ContextMenu';
import { btnAccent } from '../ui/buttons';
import { inputCls, Modal } from '../ui/Modal';
import { cn } from '../../utils/cn';
import {
  cloudAccounts,
  cloudConnect,
  cloudCopy,
  cloudFetch,
  cloudForget,
  cloudGameOf,
  cloudLabel,
  cloudMove,
  cloudPage,
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

const SERVICES = [
  { id: 'drive', label: 'Google Drive', kind: 'oauth' },
  { id: 'dropbox', label: 'Dropbox', kind: 'oauth' },
  { id: 'mega', label: 'MEGA', kind: 'account' },
  { id: 'protondrive', label: 'Proton Drive', kind: 'account' },
] as const;

const PROVIDER_LABEL: Record<string, string> = {
  drive: 'Google Drive',
  dropbox: 'Dropbox',
  mega: 'MEGA',
  protondrive: 'Proton Drive',
  ftp: 'FTP',
  sftp: 'SFTP',
  smb: 'SMB',
  webdav: 'WebDAV',
};

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
            <p className="truncate text-sm font-medium">{cloudLabel(account, accounts)}</p>
            {account.own && <p className="truncate text-[11px] text-muted">Already on this PC</p>}
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
 * rclone lives with the backup settings, not on the cloud page.
 *
 * The cloud page only mentions it when a newer copy is out, or when it is
 * missing and the player needs to know where to get it.
 */
export function CloudTools() {
  const [ready, setReady] = useState<boolean | null>(null);
  const [placed, setPlaced] = useState(false);
  const [folder, setFolder] = useState('');
  const [version, setVersion] = useState('');
  const [update, setUpdate] = useState(false);
  const [latest, setLatest] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = (status: Awaited<ReturnType<typeof cloudStatus>>) => {
    setReady(status.ready);
    setPlaced(status.placed);
    setFolder(status.folder ?? '');
    setVersion(status.version);
    setUpdate(!!status.update);
    setLatest(status.latest ?? '');
  };

  useEffect(() => {
    if (!isNative()) {
      setReady(false);
      return;
    }
    void cloudStatus().then(apply).catch(() => setReady(false));
  }, []);

  const get = async (replace = false) => {
    setBusy(replace ? 'update' : 'fetch');
    setError(null);
    setNote(null);
    try {
      setNote(await cloudFetch(replace));
      apply(await cloudStatus());
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ''));
    } finally {
      setBusy(null);
    }
  };

  const check = async () => {
    setBusy('check');
    setError(null);
    setNote(null);
    try {
      const status = await cloudStatus();
      apply(status);
      setNote(
        !status.ready
          ? 'rclone is not here yet.'
          : status.update
            ? `A newer rclone is out${status.latest ? `: ${status.latest}` : ''}.`
            : 'rclone is up to date.',
      );
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ''));
    } finally {
      setBusy(null);
    }
  };

  const where = ready === null
    ? 'Looking…'
    : !ready
      ? 'Not here yet.'
      : placed
        ? `Orbit's rclone${version ? ` · ${version}` : ''}`
        : `rclone already on this PC${version ? ` · ${version}` : ''}`;

  return (
    <div className="space-y-2 rounded-2xl border border-line/60 bg-bg/20 p-3">
      <div>
        <h4 className="text-sm font-medium">rclone</h4>
        <p className="text-[11px] text-muted">{where}</p>
      </div>
      {folder && <p className="break-all font-mono text-[11px] text-muted">{folder}</p>}
      <div className="flex flex-wrap gap-2">
        {(ready === false || (ready && !placed)) && (
          <button
            type="button"
            disabled={!isNative() || busy !== null}
            onClick={() => void get(false)}
            className={cn(btnAccent, 'rounded-lg px-3 py-1.5 text-xs disabled:opacity-50')}
          >
            {busy === 'fetch' ? 'Getting rclone…' : ready ? 'Keep a copy in Orbit' : 'Get rclone'}
          </button>
        )}
        <button
          type="button"
          disabled={!isNative() || busy !== null}
          onClick={() => void check()}
          className="rounded-lg border border-line px-3 py-1.5 text-xs text-fg hover:border-accent disabled:opacity-50"
        >
          {busy === 'check' ? 'Checking…' : 'Check for an update'}
        </button>
        {update && (
          <button
            type="button"
            disabled={!isNative() || busy !== null}
            onClick={() => void get(true)}
            title={latest ? `The current release is ${latest}` : 'A newer rclone is out'}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-fg hover:border-accent disabled:opacity-50"
          >
            {busy === 'update' ? 'Updating…' : 'Update rclone'}
          </button>
        )}
      </div>
      {note && <p className="text-xs text-fg">{note}</p>}
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
  const skip = new Set(cloudSkipOf(settings.saves));
  const dirs = settings.saves?.dirs ?? {};
  const known = [...games]
    .filter((game) => !!dirs[game.id]?.trim())
    .sort((a, b) => a.title.localeCompare(b.title));
  const chosen = known.filter((game) => !skip.has(game.id));

  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState<boolean | null>(null);
  const [update, setUpdate] = useState(false);
  const [latest, setLatest] = useState('');
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [server, setServer] = useState<(typeof SERVERS)[number]['id'] | null>(null);
  const [accountKind, setAccountKind] = useState<'mega' | 'protondrive' | null>(null);
  const [host, setHost] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [url, setUrl] = useState('');
  const [email, setEmail] = useState('');
  const [accountPass, setAccountPass] = useState('');
  const [code, setCode] = useState('');
  const [mailbox, setMailbox] = useState('');
  const [gameQuery, setGameQuery] = useState('');
  const [backupOpen, setBackupOpen] = useState(false);
  const [backupPick, setBackupPick] = useState<string[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [authOpened, setAuthOpened] = useState(true);
  const updateSaves = (patch: (current: Settings) => Partial<Settings>) => {
    (setSettings as (patch: (current: Settings) => Partial<Settings>) => void)(patch);
  };
  const pending = useRef<{ gen: number; name: string; provider: string; account?: string } | null>(null);
  const connectGen = useRef(0);
  const setSettingsRef = useRef(setSettings);
  setSettingsRef.current = setSettings;

  const refresh = () => {
    if (!isNative()) {
      setReady(false);
      return;
    }
    void cloudStatus()
      .then((status) => {
        setReady(status.ready);
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
    void listen<{ url?: string; opened?: boolean; freeing?: boolean; note?: string; signedIn?: boolean } | string>('cloud-auth', (event) => {
      const payload = event.payload;
      if (payload && typeof payload !== 'string' && payload.signedIn) {
        const item = pending.current;
        if (item && item.gen === connectGen.current) {
          (setSettingsRef.current as (patch: (current: Settings) => Partial<Settings>) => void)((current) => ({
            saves: savesWithClouds(current.saves, {
              clouds: [
                ...cloudAccounts(current.saves).filter((cloud) => cloud.remote !== item.name),
                { remote: item.name, provider: item.provider, own: false, on: true, account: item.account },
              ],
            }),
          }));
          setNote('Signed in.');
        }
        return;
      }
      if (payload && typeof payload !== 'string' && payload.note) {
        setNote(payload.note);
        return;
      }
      if (payload && typeof payload !== 'string' && payload.freeing) {
        setNote('Windows is holding the sign-in port. Allow the prompt. WSL or Docker may pause for a moment, then the browser opens.');
        return;
      }
      const link = typeof payload === 'string' ? payload : payload?.url;
      if (!link) return;
      setAuthUrl(link);
      const opened = typeof payload !== 'string' && payload.opened !== false;
      setAuthOpened(opened);
      // One opener. Opening the page again here is the second login tab.
      if (!opened) void openExternal(link);
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

  const beginConnect = (name: string, provider: string, account?: string) => {
    const gen = connectGen.current + 1;
    connectGen.current = gen;
    pending.current = { gen, name, provider, account };
    return gen;
  };

  const dropConnect = (name: string, gen: number) => {
    if (connectGen.current === gen) connectGen.current += 1;
    pending.current = null;
    updateSaves((current) => ({
      saves: savesWithClouds(current.saves, {
        clouds: cloudAccounts(current.saves).filter((cloud) => cloud.remote !== name),
      }),
    }));
  };

  const connect = async (provider: string) => {
    setBusy(provider);
    setError(null);
    setNote(null);
    setAuthUrl(null);
    setAuthOpened(true);
    const used = new Set(accounts.map((item) => item.remote));
    let name = freshRemote();
    while (used.has(name)) name = freshRemote();
    const gen = beginConnect(name, PROVIDER_LABEL[provider] ?? provider);
    try {
      const label = await cloudConnect(provider, { host, user, password, url, name });
      setPassword('');
      updateSaves((current) => ({
        saves: savesWithClouds(current.saves, {
          clouds: [
            ...cloudAccounts(current.saves).filter((cloud) => cloud.remote !== name),
            { remote: name, provider: label, own: false, on: true },
          ],
        }),
      }));
      setNote(`Connected to ${label}.`);
      setServer(null);
    } catch (e) {
      dropConnect(name, gen);
      fail(e);
    } finally {
      if (pending.current?.gen === gen) pending.current = null;
      setBusy(null);
    }
  };

  const connectAccount = async (provider: 'mega' | 'protondrive') => {
    setBusy(provider);
    setError(null);
    setNote(null);
    const used = new Set(accounts.map((item) => item.remote));
    let name = freshRemote();
    while (used.has(name)) name = freshRemote();
    const address = email.trim();
    const gen = beginConnect(name, PROVIDER_LABEL[provider] ?? provider, address);
    try {
      const label = await cloudConnect(provider, {
        user: address,
        password: accountPass,
        code,
        mailbox: provider === 'protondrive' ? mailbox : undefined,
        name,
      });
      setAccountPass('');
      setCode('');
      setMailbox('');
      updateSaves((current) => ({
        saves: savesWithClouds(current.saves, {
          clouds: [
            ...cloudAccounts(current.saves).filter((cloud) => cloud.remote !== name),
            { remote: name, provider: label, own: false, on: true, account: address },
          ],
        }),
      }));
      setNote(`Connected to ${label}.`);
      setAccountKind(null);
    } catch (e) {
      dropConnect(name, gen);
      fail(e);
    } finally {
      if (pending.current?.gen === gen) pending.current = null;
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

  const backupTo = async (targets: CloudAccount[], gamesToSend = chosen) => {
    if (accounts.length === 0) {
      setError('Sign in to a cloud first.');
      return;
    }
    if (gamesToSend.length === 0) {
      setError('Choose a game with a save folder.');
      return;
    }
    if (targets.length === 0) {
      setError('Choose a cloud.');
      return;
    }
    setBusy('up');
    setError(null);
    setNote(null);
    setBackupOpen(false);
    try {
      for (const game of gamesToSend) {
        try {
          await backupSave(game.id, game.title, dirs[game.id] ?? null, saveHintsOf(game), savePlaceOf(game, settings));
        } catch {
          // A game whose folder cannot be copied is left. The others still go.
        }
      }
      setNote(await sendToClouds(targets, 'all', settings.saves?.backupRoot, gamesToSend.map(cloudGameOf)));
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
  const menuGame = menu ? known.find((game) => game.id === menu.id) ?? null : null;
  const menuItems: MenuItem[] = menuGame
    ? [
        { kind: 'label', label: menuGame.title },
        ...(accounts.length > 1
          ? [
              { kind: 'label' as const, label: 'Sync to the cloud' },
              ...accounts.map((cloud) => ({
                label: cloudLabel(cloud, accounts),
                icon: CloudUpload,
                disabled: !isNative() || busy !== null,
                onSelect: () => void backupTo([cloud], [menuGame]),
              })),
              {
                label: 'All clouds',
                icon: CloudUpload,
                disabled: !isNative() || busy !== null,
                onSelect: () => void backupTo(accounts, [menuGame]),
              },
            ]
          : [{
              label: 'Sync to the cloud',
              icon: CloudUpload,
              disabled: !isNative() || busy !== null,
              onSelect: () => void backupTo(accounts.slice(0, 1), [menuGame]),
            }]),
      ]
    : [];

  const controls = (
    <div className="space-y-5">
      <section className="space-y-2">
        <div className="flex items-end justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium">Games</h3>
            <p className="text-[11px] text-muted">Click a cover to include it. Right-click one to sync it. Games with no save folder are left out.</p>
          </div>
          {known.length > 0 && (
            <div className="flex gap-2">
              <button type="button" onClick={() => setVisible(true)} className="text-[11px] text-muted hover:text-fg">All</button>
              <button type="button" onClick={() => setVisible(false)} className="text-[11px] text-muted hover:text-fg">None</button>
            </div>
          )}
        </div>
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
          <ul className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4 md:grid-cols-5">
            {shown.length === 0 && <li className="col-span-full text-[11px] text-muted">No match.</li>}
            {shown.map((game) => {
              const on = !skip.has(game.id);
              return (
                <li key={game.id}>
                  <button
                    type="button"
                    data-orbit-save={game.id}
                    onClick={() => setSkipped(game.id, on)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setMenu({ x: event.clientX, y: event.clientY, id: game.id });
                    }}
                    aria-pressed={on}
                    title={dirs[game.id]}
                    className={cn(
                      'w-full rounded-2xl border p-1.5 text-left transition',
                      on
                        ? 'border-accent bg-accent/15 text-fg shadow-[0_0_24px_-12px_var(--c-accent)]'
                        : 'border-line/70 bg-bg/30 text-muted hover:border-accent/40 hover:text-fg',
                    )}
                  >
                    <Cover game={game} className="aspect-[2/3] w-full rounded-lg" />
                    <span className="mt-1 block truncate text-xs font-semibold">{game.title}</span>
                    <span className="mt-0.5 block break-all text-[10px] leading-snug text-muted line-clamp-2">{dirs[game.id]}</span>
                    <span className={cn('mt-0.5 block text-[10px]', on ? 'text-accent' : 'text-muted')}>
                      {on ? 'Included' : 'Left out'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div>
          <button
            type="button"
            disabled={!isNative() || accounts.length === 0 || chosen.length === 0 || busy !== null}
            onClick={() => {
              setBackupPick(accounts.filter((account) => account.on !== false).map((account) => account.remote));
              setBackupOpen((value) => !value);
            }}
            className={cn(btnAccent, 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs disabled:opacity-50')}
          >
            {busy === 'up' ? <LoaderCircle className="size-3.5 animate-spin" /> : <CloudUpload className="size-3.5" />}
            {busy === 'up' ? 'Backing up…' : 'Back up'}
          </button>
          {backupOpen && (
            <div className="mt-2 w-full max-w-xs rounded-2xl border border-line bg-bg/40 p-2">
              <p className="px-1 pb-1 text-[11px] text-muted">Choose the clouds</p>
              {accounts.map((account) => (
                <label key={account.remote} className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1.5 text-xs text-fg hover:bg-accent/10">
                  <CheckboxBox
                    checked={backupPick.includes(account.remote)}
                    onChange={(on) => setBackupPick((current) => on
                      ? [...current, account.remote]
                      : current.filter((remote) => remote !== account.remote))}
                  />
                  <span className="min-w-0 truncate">{cloudLabel(account, accounts)}</span>
                </label>
              ))}
              <button
                type="button"
                disabled={busy !== null || backupPick.length === 0}
                onClick={() => void backupTo(accounts.filter((account) => backupPick.includes(account.remote)))}
                className={cn(btnAccent, 'mt-1 w-full rounded-lg px-3 py-1.5 text-xs disabled:opacity-50')}
              >
                Back up to these
              </button>
            </div>
          )}
        </div>
      </section>

      {ready === false && (
        <p className="text-xs text-muted">rclone is not here yet. Get it in Settings, under Backups.</p>
      )}
      {update && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-accent bg-accent/15 px-3 py-2 shadow-[0_0_24px_-12px_var(--c-accent)]">
          <p className="text-xs text-fg">A newer rclone is out{latest ? ` · ${latest}` : ''}.</p>
          <button
            type="button"
            disabled={!isNative() || busy !== null}
            onClick={() => void getRclone(true)}
            className={cn(btnAccent, 'rounded-lg px-3 py-1.5 text-xs disabled:opacity-50')}
          >
            {busy === 'update' ? 'Updating…' : 'Update rclone'}
          </button>
        </div>
      )}

      <section className="space-y-2">
        <div className="flex items-end justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium">Connected</h3>
            <p className="text-[11px] text-muted">A lit card is included when a backup is also sent to the cloud.</p>
          </div>
          {accounts.length > 0 && <p className="text-[11px] text-muted">Disconnect in Settings, under Backups.</p>}
        </div>
        {accounts.length === 0 && <p className="text-xs text-muted">None yet. Add one below.</p>}
        <div className="grid gap-2">
          {accounts.map((account) => (
            <CloudCard
              key={account.remote}
              title={cloudLabel(account, accounts)}
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
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">Add a cloud</h3>
          <p className="text-[11px] text-muted">Google Drive and Dropbox open a sign-in page. MEGA and Proton Drive use the email and password. The same service can be added again.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SERVICES.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={!isNative() || !ready || busy !== null}
              onClick={() => {
                if (item.kind === 'account') {
                  setServer(null);
                  setAccountKind(accountKind === item.id ? null : item.id);
                  return;
                }
                setAccountKind(null);
                void connect(item.id);
              }}
              className={cn(
                'rounded-2xl border px-3 py-3 text-sm font-semibold transition disabled:opacity-50',
                accountKind === item.id
                  ? 'border-accent bg-accent/15 text-fg shadow-[0_0_24px_-12px_var(--c-accent)]'
                  : 'border-line/70 bg-bg/30 text-fg hover:border-accent/40',
              )}
            >
              {busy === item.id ? (note === 'Signed in.' ? 'Finishing…' : 'Waiting…') : item.label}
            </button>
          ))}
        </div>
        {accountKind && (
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="mb-1 block text-[11px] text-muted">Email</span>
              <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} spellCheck={false} autoComplete="off" />
            </label>
            <label className="sm:col-span-2">
              <span className="mb-1 block text-[11px] text-muted">Password</span>
              <input className={inputCls} type="password" value={accountPass} onChange={(e) => setAccountPass(e.target.value)} autoComplete="new-password" />
            </label>
            <label className={accountKind === 'protondrive' ? '' : 'sm:col-span-2'}>
              <span className="mb-1 block text-[11px] text-muted">Two-factor code, if this account asks for one</span>
              <input className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} autoComplete="one-time-code" />
            </label>
            {accountKind === 'protondrive' && (
              <label>
                <span className="mb-1 block text-[11px] text-muted">Mailbox password, if this account has one</span>
                <input className={inputCls} type="password" value={mailbox} onChange={(e) => setMailbox(e.target.value)} autoComplete="new-password" />
              </label>
            )}
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void connectAccount(accountKind)}
              className={cn(btnAccent, 'rounded-lg px-3 py-1.5 text-xs disabled:opacity-50 sm:col-span-2 sm:justify-self-start')}
            >
              {busy === accountKind ? (note === 'Signed in.' ? 'Finishing…' : 'Connecting…') : 'Connect'}
            </button>
          </div>
        )}

        <div className="space-y-2 rounded-2xl border border-line/60 bg-bg/20 p-3">
          <h4 className="text-sm font-medium">Server</h4>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {SERVERS.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={!isNative() || !ready || busy !== null}
                onClick={() => {
                  setAccountKind(null);
                  setServer(server === item.id ? null : item.id);
                }}
                className={cn(
                  'rounded-2xl border px-3 py-2.5 text-left text-sm font-semibold transition disabled:opacity-50',
                  server === item.id
                    ? 'border-accent bg-accent/15 text-fg shadow-[0_0_24px_-12px_var(--c-accent)]'
                    : 'border-line/70 bg-bg/30 text-muted hover:border-accent/40 hover:text-fg',
                )}
              >
                {item.id === 'smb' ? 'Shared folder' : item.label}
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
        </div>

      </section>

      {!isNative() && <p className="text-xs text-muted">Cloud copies need the desktop app.</p>}
      {authUrl && !authOpened && (
        <p className="text-xs text-muted">
          The sign-in page should be open. If it is not,{' '}
          <button type="button" onClick={() => void openExternal(authUrl)} className="text-accent underline-offset-2 hover:underline">
            open it again
          </button>
          .
        </p>
      )}
      {note && <p className="text-xs text-fg">{note}</p>}
      {error && <p className="break-words text-xs text-rose-300">{error}</p>}
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
          subtitle="Mark the clouds and the games. A lit card is included."
          size="xl"
          onClose={() => setOpen(false)}
        >
          {controls}
        </Modal>
      )}
      {menu && menuGame && createPortal(
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} className="z-[70]" />,
        document.body,
      )}
    </>
  );
}

function CloudCard({
  title,
  account,
  others,
  busy,
  onIncluded,
  onFolder,
  onSend,
  onCopyFrom,
  fail,
}: {
  title: string;
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
    } catch (e) {
      fail(e);
    } finally {
      setMoving(false);
    }
  };

  const marked = account.on !== false;

  return (
    <div
      className={cn(
        'space-y-3 rounded-2xl border p-3 transition',
        marked
          ? 'border-accent bg-accent/15 shadow-[0_0_24px_-12px_var(--c-accent)]'
          : 'border-line/70 bg-bg/30',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={() => onIncluded(!marked)} className="min-w-0 text-left">
          <span className="block truncate text-sm font-semibold">{title}</span>
          <span className={cn('mt-0.5 block text-[11px]', marked ? 'text-accent' : 'text-muted')}>
            {marked ? 'Backups go here' : 'Click to include'}
          </span>
        </button>
        {page && (
          <button
            type="button"
            onClick={() => void openExternal(page)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs text-fg hover:border-accent"
          >
            <ExternalLink className="size-3.5" />
            Open {account.provider || 'cloud'}
          </button>
        )}
      </div>
      <label className="block">
        <span className="mb-1 block text-[11px] text-muted">Folder on this cloud</span>
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
            disabled={busy !== null || moving || (path.trim() || 'Orbit') === (account.folder?.trim() || 'Orbit')}
            onClick={() => void move()}
            className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs text-fg hover:border-accent disabled:opacity-50"
          >
            {moving ? 'Moving…' : 'Move'}
          </button>
        </div>
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => onSend(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs text-fg hover:border-accent disabled:opacity-50"
        >
          {busy === `send-${account.remote}` ? <LoaderCircle className="size-3.5 animate-spin" /> : <CloudUpload className="size-3.5" />}
          Send copies
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => onSend(false)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-fg disabled:opacity-50"
        >
          {busy === `down-${account.remote}` ? <LoaderCircle className="size-3.5 animate-spin" /> : <CloudDownload className="size-3.5" />}
          Copy to this PC
        </button>
        {others.length > 0 && (
          <button
            type="button"
            onClick={() => setCopying((on) => !on)}
            className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-fg"
          >
            Copy from another cloud
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
              {busy === `copy-${account.remote}` ? 'Copying…' : cloudLabel(other, [account, ...others])}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

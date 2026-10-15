import { useEffect, useState } from 'react';
import { Cloud, CloudDownload, CloudUpload, LoaderCircle } from 'lucide-react';
import type { Settings } from '../../types';
import { Checkbox } from '../ui/Checkbox';
import { btnAccent } from '../ui/buttons';
import { inputCls, Modal } from '../ui/Modal';
import { cn } from '../../utils/cn';
import {
  cloudAttach,
  cloudConnect,
  cloudCopy,
  cloudFetch,
  cloudForget,
  cloudRemotes,
  cloudStatus,
  isNative,
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
}: {
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => void;
}) {
  const cloud = settings.saves?.cloud;
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState<boolean | null>(null);
  const [placed, setPlaced] = useState(false);
  const [version, setVersion] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [server, setServer] = useState<(typeof SERVERS)[number]['id'] | null>(null);
  const [host, setHost] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [url, setUrl] = useState('');
  const [remotes, setRemotes] = useState<string[] | null>(null);

  const refresh = () => {
    if (!isNative()) {
      setReady(false);
      return;
    }
    void cloudStatus()
      .then((status) => {
        setReady(status.ready);
        setPlaced(status.placed);
        setVersion(status.version);
      })
      .catch(() => setReady(false));
  };

  useEffect(() => {
    refresh();
  }, []);

  const saveCloud = (next: CloudSettings | undefined) => {
    const saves = { ...(settings.saves ?? {}) } as NonNullable<Settings['saves']> & { syncTo?: string };
    delete saves.syncTo;
    setSettings({ saves: { ...saves, cloud: next } });
  };

  const fail = (e: unknown) => setError(String(e).replace(/^Error:\s*/, ''));

  const getRclone = async () => {
    setBusy('fetch');
    setError(null);
    setNote(null);
    try {
      setNote(await cloudFetch());
      const status = await cloudStatus();
      setReady(status.ready);
      setPlaced(status.placed);
      setVersion(status.version);
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
    try {
      const label = await cloudConnect(provider, { host, user, password, url });
      setPassword('');
      saveCloud({
        remote: 'orbit',
        provider: label,
        own: false,
        auto: cloud?.auto ?? false,
      });
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
      await cloudAttach(remote);
      saveCloud({
        remote,
        provider: remote,
        own: true,
        auto: cloud?.auto ?? false,
      });
      setNote(`Using ${remote}. Forgetting it here does not remove it from rclone.`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const send = async (up: boolean) => {
    if (!cloud?.remote) return;
    setBusy(up ? 'up' : 'down');
    setError(null);
    setNote(null);
    try {
      setNote(await cloudCopy(up, cloud.remote, cloud.own, settings.saves?.backupRoot));
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
      saveCloud(undefined);
      setNote(cloud?.own ? 'Stopped using that remote. It is still in rclone.' : 'Forgot that cloud.');
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
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-fg">
                {ready === null ? 'Looking for rclone…' : `${where}${version ? ` · ${version}` : ''}`}
              </p>
              {ready === false && (
                <button
                  type="button"
                  disabled={!isNative() || busy !== null}
                  onClick={() => void getRclone()}
                  className={cn(btnAccent, 'rounded-lg px-3 py-1.5 text-xs disabled:opacity-50')}
                >
                  {busy === 'fetch' ? 'Getting rclone…' : 'Get rclone'}
                </button>
              )}
            </div>
            <p className="text-xs text-muted">
              If rclone is already on this PC, that one is used. Otherwise Orbit keeps its own copy. Neither is a system install.
            </p>

            {!isNative() && <p className="text-xs text-muted">Cloud copies need the desktop app.</p>}

            {cloud?.remote ? (
              <div className="space-y-3 rounded-xl border border-line bg-panel2/40 p-3">
                <p className="text-sm font-medium">{cloud.provider || cloud.remote}</p>
                <Checkbox
                  checked={!!cloud.auto}
                  onChange={(auto) => saveCloud({ ...cloud, auto })}
                  label="Send after a backup"
                />
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

            {note && <p className="text-xs text-fg">{note}</p>}
            {error && <p className="text-xs text-rose-300">{error}</p>}
          </div>
        </Modal>
      )}
    </>
  );
}

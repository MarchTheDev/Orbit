import { useState } from 'react';
import { FileDown, FileUp } from 'lucide-react';
import { ask } from '@tauri-apps/plugin-dialog';
import type { Settings } from '../types';
import { pickFile, pickSaveFile } from '../services/desktop';
import {
  exportCopy,
  importCopy,
  isNative,
  previewCopy,
  setExeContextMenu,
  setLaunchOnStartup,
  type CopyPreview,
  type CopyResult,
} from '../services/native';
import { btnAccent } from './ui/buttons';
import { cn } from '../utils/cn';

/**
 * A file the player keeps. Settings always. Journal and sessions only if asked.
 *
 * The library of games is not in the file. A row comes back only when a game
 * already here matches it, by id and then by title.
 */
export function CopySettings({
  settings,
  replaceSettings,
  onLibraryChanged,
}: {
  settings: Settings;
  replaceSettings: (settings: Partial<Settings>) => void;
  onLibraryChanged?: () => void;
}) {
  const native = isNative();
  const [journal, setJournal] = useState(false);
  const [sessions, setSessions] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ path: string; file: CopyPreview } | null>(null);
  const [bringSettings, setBringSettings] = useState(true);
  const [bringJournal, setBringJournal] = useState(false);
  const [bringSessions, setBringSessions] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    setNotice(null);
    const path = await pickSaveFile('Save an Orbit file', 'Orbit-copy.json', ['json']);
    if (!path) return;
    setBusy(true);
    try {
      const info = await exportCopy(path, settings, journal, sessions);
      const clouds = info.clouds ?? 0;
      const parts = [clouds > 0 ? `Saved. Settings are in the file, including ${count(clouds, 'signed-in cloud')}.` : 'Saved. Settings are in the file.'];
      if (journal) parts.push(`${count(info.playthroughs, 'playthrough')} and ${count(info.logs, 'journal entry', 'journal entries')}.`);
      else parts.push('Journal was left out.');
      if (sessions) parts.push(`${count(info.sessions, 'session')}.`);
      else parts.push('Sessions were left out.');
      setNotice(parts.join(' '));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const choose = async () => {
    setError(null);
    setNotice(null);
    const path = await pickFile('Choose an Orbit file', ['json']);
    if (!path) return;
    setBusy(true);
    try {
      const file = await previewCopy(path);
      setPreview({ path, file });
      setBringSettings(file.hasSettings);
      setBringJournal(journal && file.playthroughs + file.logs > 0);
      setBringSessions(sessions && file.sessions > 0);
    } catch (reason) {
      setPreview(null);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const bringIn = async () => {
    if (!preview) return;
    if (!bringSettings && !bringJournal && !bringSessions) {
      setError('Light what to bring in.');
      return;
    }
    if (bringSettings) {
      const ok = await ask(
        'Replace this computer’s global settings with the ones in the file? That includes themes, folders, overlay preferences, shortcuts, saved keys, and signed-in clouds. Game records and per-game settings are not included.',
        { title: 'Orbit', kind: 'warning' },
      );
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await importCopy(preview.path, bringJournal, bringSessions, bringSettings);
      if (bringSettings && result.settings) {
        const imported = result.settings as Partial<Settings>;
        replaceSettings(imported);
        if (typeof imported.launchOnStartup === 'boolean') {
          await setLaunchOnStartup(imported.launchOnStartup).catch(() => undefined);
        }
        if (typeof imported.openExeInOrbit === 'boolean') {
          await setExeContextMenu(imported.openExeInOrbit).catch(() => undefined);
        }
      }
      if (bringJournal || bringSessions) {
        onLibraryChanged?.();
        window.dispatchEvent(new Event('orbit-imported'));
      }
      setNotice(describe(result, bringSettings));
      setPreview(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        <Piece title="Settings" detail="Always in the file, with signed-in clouds" on locked />
        <Piece
          title="Journal"
          detail={journal ? 'In the file' : 'Click to include'}
          on={journal}
          disabled={!native || busy}
          onClick={() => setJournal((value) => !value)}
        />
        <Piece
          title="Sessions"
          detail={sessions ? 'In the file' : 'Click to include'}
          on={sessions}
          disabled={!native || busy}
          onClick={() => setSessions((value) => !value)}
        />
      </div>
      <p className="text-xs leading-relaxed text-muted">
        A lit box goes into the file. Global Settings—including overlay preferences and shortcuts—always go in. Game records, per-game settings such as Proton choices, and save files do not. Settings includes keys and signed-in clouds, so keep the file somewhere you trust.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3 rounded-2xl border border-accent/25 bg-accent/[0.04] p-4">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-accent/25 bg-accent/10 text-accent">
            <FileDown className="size-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-fg">Save a file</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              The lit boxes above decide what is written.
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={!native || busy}
          onClick={() => void save()}
          className={`${btnAccent} rounded-lg px-3 py-1.5 text-xs disabled:opacity-50`}
        >
          Save a file
        </button>
      </div>

      <div className="space-y-3 rounded-2xl border border-line/50 bg-bg/20 p-4">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-line bg-panel text-muted">
            <FileUp className="size-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-fg">Bring a file in</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Match each row to a game already here, by id and then by title. A game that is not in this library is skipped. Notes you have already written are kept.
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={!native || busy}
          onClick={() => void choose()}
          className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition hover:border-accent/50 hover:text-fg disabled:opacity-50"
        >
          Choose a file
        </button>
        {preview && (
          <div className="space-y-3">
            <p className="text-xs text-muted">{describePreview(preview.file)}</p>
            <div className="grid gap-2">
              <Piece
                title="Settings"
                detail={bringSettings ? 'Will replace yours' : 'Left as they are'}
                on={bringSettings}
                disabled={!preview.file.hasSettings || busy}
                onClick={() => setBringSettings((value) => !value)}
              />
              <Piece
                title="Journal"
                detail={bringJournal ? 'Will come in' : 'Left out'}
                on={bringJournal}
                disabled={preview.file.playthroughs + preview.file.logs === 0 || busy}
                onClick={() => setBringJournal((value) => !value)}
              />
              <Piece
                title="Sessions"
                detail={bringSessions ? 'Will come in' : 'Left out'}
                on={bringSessions}
                disabled={preview.file.sessions === 0 || busy}
                onClick={() => setBringSessions((value) => !value)}
              />
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void bringIn()}
              className={`${btnAccent} rounded-lg px-3 py-1.5 text-xs disabled:opacity-50`}
            >
              Bring in what is lit
            </button>
          </div>
        )}
        {!native && <p className="text-xs text-muted">Saving or bringing in a file needs the desktop app.</p>}
      </div>
      </div>
      {error && (
        <p role="alert" className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {error}
        </p>
      )}
      {notice && <p className="text-xs text-muted">{notice}</p>}
    </div>
  );
}

function Piece({
  title,
  detail,
  on,
  locked = false,
  disabled = false,
  onClick,
}: {
  title: string;
  detail: string;
  on: boolean;
  locked?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={locked || disabled}
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        'rounded-2xl border px-3 py-3 text-left transition',
        on
          ? 'border-accent bg-accent/15 text-fg shadow-[0_0_24px_-12px_var(--c-accent)]'
          : 'border-line/70 bg-bg/30 text-muted hover:border-accent/40 hover:text-fg',
        locked && 'cursor-default',
        disabled && !locked && 'cursor-not-allowed opacity-40',
      )}
    >
      <span className="block text-sm font-semibold">{title}</span>
      <span className={cn('mt-0.5 block text-[11px]', on ? 'text-accent' : 'text-muted')}>{detail}</span>
    </button>
  );
}

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function describePreview(file: CopyPreview): string {
  const clouds = file.clouds ?? 0;
  const settingsLine = file.hasSettings
    ? clouds > 0
      ? `Settings are in this file, with ${count(clouds, 'signed-in cloud')}.`
      : 'Settings are in this file.'
    : 'Settings are not in this file.';
  const when = file.exportedAt ? ` Saved ${file.exportedAt.slice(0, 10)}.` : '';
  const newer = file.version > 1 ? ' This copy is from a newer Orbit. What this version understands can still come in.' : '';
  return `${settingsLine} ${count(file.playthroughs, 'playthrough')}, ${count(file.logs, 'journal entry', 'journal entries')}, ${count(file.sessions, 'session')}.${when}${newer}`;
}

function describe(result: CopyResult, settings: boolean): string {
  const parts: string[] = [];
  if (settings && result.settings) {
    parts.push(result.cloudsRestored ? 'Settings on this computer were replaced, including signed-in clouds.' : 'Settings on this computer were replaced.');
    const file = (result.settings as { sound?: { file?: string | null } }).sound?.file;
    if (file) parts.push('A music file from another computer plays only if that file is on this one too. Otherwise the default chord is used.');
  }
  if (result.playthroughsAdded) parts.push(`${count(result.playthroughsAdded, 'playthrough')} added.`);
  if (result.notesFilled) parts.push(`${count(result.notesFilled, 'empty note')} filled.`);
  if (result.logsAdded) parts.push(`${count(result.logsAdded, 'journal entry', 'journal entries')} added.`);
  if (result.sessionsAdded) parts.push(`${count(result.sessionsAdded, 'session')} added.`);
  if (result.unmatchedCount) {
    const names = result.unmatched.length ? `: ${result.unmatched.join(', ')}` : '';
    parts.push(`${count(result.unmatchedCount, 'game')} in the file ${result.unmatchedCount === 1 ? 'is' : 'are'} not in this library, so those rows were left out${names}.`);
  }
  if (parts.length === 0) parts.push('Nothing new to bring in. What was already here was left as it was.');
  return parts.join(' ');
}

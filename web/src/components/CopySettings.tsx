import { useState } from 'react';
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
import { Checkbox } from './ui/Checkbox';
import { btnAccent } from './ui/buttons';

/**
 * A file the player keeps. Settings always. Journal and sessions only if asked.
 *
 * The library of games is not in the file. A row comes back only when a game
 * already here matches it, by id and then by title.
 */
export function CopySettings({
  settings,
  setSettings,
  onLibraryChanged,
}: {
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => void;
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
    const path = await pickSaveFile('Save a copy of Orbit', 'Orbit-copy.json', ['json']);
    if (!path) return;
    setBusy(true);
    try {
      const info = await exportCopy(path, settings, journal, sessions);
      const parts = ['Saved. Settings are in the file.'];
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
    const path = await pickFile('Choose an Orbit copy', ['json']);
    if (!path) return;
    setBusy(true);
    try {
      const file = await previewCopy(path);
      setPreview({ path, file });
      setBringSettings(file.hasSettings);
      setBringJournal(false);
      setBringSessions(false);
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
      setError('Tick what to bring in.');
      return;
    }
    if (bringSettings) {
      const ok = await ask(
        'Replace the settings on this computer with the ones in the file? Themes, folders, and saved keys are overwritten. The library of games is not.',
        { title: 'Orbit', kind: 'warning' },
      );
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await importCopy(preview.path, bringJournal, bringSessions);
      if (bringSettings && result.settings) {
        const imported = result.settings as Partial<Settings>;
        setSettings(imported);
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
      <div className="space-y-3 rounded-2xl border border-line/50 bg-bg/20 p-4">
        <p className="text-xs leading-relaxed text-muted">
          A file you keep. It does not include your library of games. Journal and sessions stay out unless you tick them.
          The file includes whatever Settings holds, so keep it somewhere you trust.
        </p>
        <Checkbox
          checked={journal}
          onChange={setJournal}
          disabled={!native || busy}
          label="Include the journal"
          hint="Playthroughs, their notes, and journal entries."
        />
        <Checkbox
          checked={sessions}
          onChange={setSessions}
          disabled={!native || busy}
          label="Include sessions"
          hint="The time already counted, with the playthrough it was played on."
        />
        <button
          type="button"
          disabled={!native || busy}
          onClick={() => void save()}
          className={`${btnAccent} rounded-lg px-3 py-1.5 text-xs disabled:opacity-50`}
        >
          Save a copy
        </button>
      </div>

      <div className="space-y-3 rounded-2xl border border-line/50 bg-bg/20 p-4">
        <p className="text-xs leading-relaxed text-muted">
          Bringing a copy in matches each row to a game already here, by id and then by title. A game that is not in this
          library is skipped. Notes you have already written are kept.
        </p>
        <button
          type="button"
          disabled={!native || busy}
          onClick={() => void choose()}
          className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition hover:border-accent/50 hover:text-fg disabled:opacity-50"
        >
          Choose a copy
        </button>
        {preview && (
          <div className="space-y-3">
            <p className="text-xs text-muted">{describePreview(preview.file)}</p>
            <Checkbox
              checked={bringSettings}
              onChange={setBringSettings}
              disabled={!preview.file.hasSettings || busy}
              label="Replace settings"
              hint="Overwrites themes, folders, and keys on this computer. You will be asked to confirm."
            />
            <Checkbox
              checked={bringJournal}
              onChange={setBringJournal}
              disabled={preview.file.playthroughs + preview.file.logs === 0 || busy}
              label="Bring in the journal"
              hint="Adds playthroughs and entries that are not already here. Empty notes are filled. Notes already written stay."
            />
            <Checkbox
              checked={bringSessions}
              onChange={setBringSessions}
              disabled={preview.file.sessions === 0 || busy}
              label="Bring in sessions"
              hint="Adds sessions that are not already here. Time already counted is not removed."
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void bringIn()}
              className={`${btnAccent} rounded-lg px-3 py-1.5 text-xs disabled:opacity-50`}
            >
              {bringSettings ? 'Replace settings and bring in what is ticked' : 'Bring in what is ticked'}
            </button>
          </div>
        )}
        {!native && <p className="text-xs text-muted">A copy needs the desktop app.</p>}
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

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function describePreview(file: CopyPreview): string {
  const settingsLine = file.hasSettings ? 'Settings are in this file.' : 'Settings are not in this file.';
  const when = file.exportedAt ? ` Saved ${file.exportedAt.slice(0, 10)}.` : '';
  const newer = file.version > 1 ? ' This copy is from a newer Orbit. What this version understands can still come in.' : '';
  return `${settingsLine} ${count(file.playthroughs, 'playthrough')}, ${count(file.logs, 'journal entry', 'journal entries')}, ${count(file.sessions, 'session')}.${when}${newer}`;
}

function describe(result: CopyResult, settings: boolean): string {
  const parts: string[] = [];
  if (settings && result.settings) {
    parts.push('Settings on this computer were replaced.');
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

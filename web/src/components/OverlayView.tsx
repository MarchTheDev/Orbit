import { useEffect, useState } from 'react';
import { Camera, Circle, FolderOpen, Square, Video, X } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { applyFont, applyTheme } from '../data/themes';
import { loadSettings } from '../services/storage';
import {
  overlayFolder,
  overlayHide,
  overlayRecord,
  overlayReplay,
  overlayShot,
  overlayStatus,
  type OverlayStatus,
} from '../services/native';
import { cn } from '../utils/cn';
import { AppMixer } from './AppMixer';

function stamp(): string {
  const now = new Date();
  const part = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${part(now.getMonth() + 1)}-${part(now.getDate())} ${part(now.getHours())}-${part(now.getMinutes())}-${part(now.getSeconds())}`;
}

function controls(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-overlay]:not([disabled])'));
}

function markPad(next: HTMLElement) {
  document.documentElement.classList.add('orbit-pad');
  document.querySelectorAll('.orbit-pad-focus').forEach((node) => node.classList.remove('orbit-pad-focus'));
  next.classList.add('orbit-pad-focus');
  next.scrollIntoView({ block: 'nearest' });
}

function move(delta: number, fromPad: boolean) {
  const list = controls();
  if (list.length === 0) return;
  const index = list.findIndex((item) => item === document.activeElement);
  const next = list[(index + delta + list.length) % list.length];
  next.focus();
  if (fromPad) markPad(next);
}

function focusSection(name: string) {
  const next = document.querySelector(`[data-overlay-section="${name}"] button[data-overlay]:not([disabled])`);
  if (!(next instanceof HTMLElement)) return;
  next.focus();
  markPad(next);
}

function mixId(node: Element | null): string | null {
  return node?.closest('[data-mix]')?.getAttribute('data-mix') ?? null;
}

/** A short click. It is not the background music, and it does not use a file. */
function playShutter() {
  const Context = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return;
  const ctx = new Context();
  const now = ctx.currentTime;
  const click = ctx.createOscillator();
  const gain = ctx.createGain();
  click.type = 'triangle';
  click.frequency.setValueAtTime(1400, now);
  click.frequency.exponentialRampToValueAtTime(280, now + 0.09);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.16, now + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
  click.connect(gain);
  gain.connect(ctx.destination);
  void ctx.resume();
  click.start(now);
  click.stop(now + 0.13);
  click.onended = () => void ctx.close();
}

/**
 * The panel opened with Alt+X or Start+Select.
 *
 * It is its own window, so it does not load the library. A controller moves
 * these buttons from the desktop reader. The browser pad is not asked.
 */
export function OverlayView() {
  const [status, setStatus] = useState<OverlayStatus | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const refresh = () => {
    void overlayStatus().then(setStatus).catch(() => undefined);
  };

  useEffect(() => {
    document.body.style.background = 'var(--c-panel)';
    void loadSettings().then((settings) => {
      applyTheme(settings.theme);
      applyFont(settings.fontFamily ?? 'system');
    });
    refresh();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        void overlayHide();
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        event.preventDefault();
        move(1, false);
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        event.preventDefault();
        move(-1, false);
      }
    };
    const onPointer = () => {
      document.documentElement.classList.remove('orbit-pad');
      document.querySelectorAll('.orbit-pad-focus').forEach((node) => node.classList.remove('orbit-pad-focus'));
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer, true);
    let stopShown = () => {};
    let stopPad = () => {};
    void listen('overlay-shown', () => {
      refresh();
      window.setTimeout(() => controls()[0]?.focus(), 30);
    }).then((unlisten) => {
      stopShown = unlisten;
    }).catch(() => undefined);
    void listen<string>('overlay-pad', (event) => {
      const action = event.payload;
      if (action === 'back') {
        void overlayHide();
        return;
      }
      if (action === 'page-left') {
        focusSection('clips');
        return;
      }
      if (action === 'page-right') {
        focusSection('apps');
        return;
      }
      if (action === 'activate') {
        const current = document.activeElement;
        if (current instanceof HTMLButtonElement) current.click();
        else controls()[0]?.click();
        return;
      }
      if ((action === 'left' || action === 'right') && mixId(document.activeElement)) {
        window.dispatchEvent(new CustomEvent('orbit-mix', {
          detail: { id: mixId(document.activeElement), delta: action === 'left' ? -5 : 5 },
        }));
        return;
      }
      if (action === 'up' || action === 'left') move(-1, true);
      if (action === 'down' || action === 'right') move(1, true);
    }).then((unlisten) => {
      stopPad = unlisten;
    }).catch(() => undefined);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer, true);
      stopShown();
      stopPad();
    };
  }, []);

  const run = async (work: () => Promise<string>, shot = false) => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      setNote(await work());
      if (shot) {
        const settings = await loadSettings().catch(() => null);
        if (settings?.overlay?.shutter !== false) playShutter();
      }
      refresh();
    } catch (error) {
      setFailed(true);
      setNote(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const seconds = status?.seconds ?? 30;
  const custom = seconds !== 30 && seconds !== 45 && seconds !== 60;
  const standing = !status
    ? 'Opening…'
    : status.recording
      ? 'Recording. Open this again and press Stop.'
      : !status.ffmpeg
        ? 'A screenshot still works. Recording needs ffmpeg.'
        : status.playing && status.replay
          ? `Keeping the last ${seconds} seconds${status.game ? ` of ${status.game}` : ''}.`
          : 'No game is playing. A screenshot or a recording still works.';

  const row = 'w-full rounded-xl border border-line bg-panel2 px-3 py-2.5 text-left text-sm transition hover:border-accent disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div className="flex h-full flex-col bg-panel text-fg">
      <header data-tauri-drag-region className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div data-tauri-drag-region className="min-w-0">
          <p data-tauri-drag-region className="text-sm font-semibold">Overlay</p>
          <p data-tauri-drag-region className="truncate text-[11px] text-muted">{status?.game || 'No game playing'}</p>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={() => void overlayHide()}
          className="grid size-8 shrink-0 place-items-center rounded-lg border border-line text-muted hover:border-accent hover:text-fg"
        >
          <X className="size-4" />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
        <p className={cn('text-xs leading-relaxed', failed || note ? 'text-fg' : 'text-muted')}>{note || standing}</p>
        <div data-overlay-section="clips" className="flex flex-col gap-2">
        <button
          type="button"
          data-overlay
          disabled={busy}
          onClick={() => void run(() => overlayShot(stamp()), true)}
          className="btn-accent flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm disabled:opacity-40"
        >
          <Camera className="size-4" />
          Screenshot
        </button>
        <button
          type="button"
          data-overlay
          disabled={busy || status?.ffmpeg === false}
          onClick={() => void run(() => overlayRecord(stamp()))}
          className={cn(row, 'flex items-center gap-2')}
        >
          {status?.recording ? <Square className="size-4 text-accent2" /> : <Video className="size-4 text-accent" />}
          {status?.recording ? 'Stop recording' : 'Start recording'}
          {status?.recording && <Circle className="ml-auto size-2.5 fill-accent2 text-accent2" />}
        </button>
        <p className="pt-1 text-[11px] uppercase tracking-widest text-muted">Save the last</p>
        <div className="grid grid-cols-3 gap-2">
          {[30, 45, 60].map((length) => (
            <button
              key={length}
              type="button"
              data-overlay
              disabled={busy || status?.ffmpeg === false}
              onClick={() => void run(() => overlayReplay(length, stamp()))}
              className={row + ' text-center'}
            >
              {length}s
            </button>
          ))}
        </div>
        {custom && (
          <button
            type="button"
            data-overlay
            disabled={busy || status?.ffmpeg === false}
            onClick={() => void run(() => overlayReplay(seconds, stamp()))}
            className={row}
          >
            Save the last {seconds} seconds
          </button>
        )}
        <button
          type="button"
          data-overlay
          disabled={busy}
          onClick={() => void run(async () => {
            await overlayFolder();
            return 'Opened the clips folder.';
          })}
          className={cn(row, 'flex items-center gap-2')}
        >
          <FolderOpen className="size-4 text-muted" />
          Open clips folder
        </button>
        {status?.folder && <p className="break-all font-mono text-[10px] leading-relaxed text-muted">{status.folder}</p>}
        </div>
        <div data-overlay-section="apps" className="mt-2 flex flex-col gap-2">
          <p className="text-[11px] uppercase tracking-widest text-muted">Apps</p>
          <p className="text-[11px] leading-relaxed text-muted">Left and right change the one that is highlighted. LB and RB jump between the clips and these.</p>
          <AppMixer pad />
        </div>
      </div>
    </div>
  );
}

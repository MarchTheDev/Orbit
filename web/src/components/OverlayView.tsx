import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Camera, Circle, FolderOpen, Image, Square, X } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { applyFont, applyTheme } from '../data/themes';
import { loadSettings } from '../services/storage';
import {
  overlayGallery,
  overlayHide,
  overlayOpen,
  overlayOpenKind,
  overlayRecord,
  overlayReplay,
  overlayShot,
  overlayStatus,
  type GalleryItem,
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
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [tab, setTab] = useState<GalleryItem['kind']>('screenshot');

  const refresh = () => {
    void overlayStatus().then(setStatus).catch(() => undefined);
    void overlayGallery().then(setItems).catch(() => undefined);
  };

  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
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
      window.setTimeout(() => {
        const next = document.querySelector('[data-overlay-section="capture"] button[data-overlay]:not([disabled])');
        if (next instanceof HTMLElement) next.focus();
      }, 30);
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
        focusSection('apps');
        return;
      }
      if (action === 'page-right') {
        focusSection('gallery');
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
          detail: { id: mixId(document.activeElement), delta: action === 'left' ? -1 : 1 },
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
  const quality = status?.quality === '4k' ? '4K' : status?.quality || '1080p';
  const fps = status?.fps === 60 ? 60 : 30;
  const standing = !status
    ? 'Opening…'
    : status.recording
      ? 'Recording. Press the red button to stop.'
      : status.playing && status.replay
        ? `Keeping the last ${seconds} seconds${status.game ? ` of ${status.game}` : ''}.`
        : 'Screenshot, record, or save the last few seconds.';
  const shown = note || status?.note || standing;

  const shownItems = items.filter((item) => item.kind === tab);

  return (
    <div className="relative h-full text-white">
      <div className="absolute inset-0 bg-black/45" onClick={() => void overlayHide()} />
      <aside data-overlay-section="apps" className="pointer-events-auto absolute left-6 top-6 flex max-h-[calc(100%-15rem)] w-[18.5rem] flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#141416]/92 text-fg shadow-2xl backdrop-blur-md">
        <div className="px-4 pt-4">
          <p className="text-[11px] uppercase tracking-widest text-white/50">Apps</p>
          <p className="mb-2 text-[11px] leading-relaxed text-white/45">Left and right change the highlighted volume by 1. LB jumps here. RB jumps to the gallery.</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <AppMixer pad />
        </div>
      </aside>
      <aside data-overlay-section="gallery" className="pointer-events-auto absolute right-6 top-6 flex max-h-[calc(100%-15rem)] w-[20rem] flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#141416]/92 shadow-2xl backdrop-blur-md">
        <div className="flex items-center justify-between gap-2 px-4 pt-4">
          <p className="text-[11px] uppercase tracking-widest text-white/50">Gallery</p>
          <button
            type="button"
            data-overlay
            aria-label="Close"
            onClick={() => void overlayHide()}
            className="grid size-8 place-items-center rounded-full text-white/70 hover:bg-white/10 hover:text-white"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-2 flex gap-1 px-4">
          {([
            ['screenshot', 'Shots'],
            ['recording', 'Recordings'],
            ['replay', 'Replays'],
          ] as const).map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              data-overlay
              onClick={() => setTab(kind)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px]',
                tab === kind ? 'border-white bg-white text-black' : 'border-white/20 text-white/75 hover:border-white/50',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto px-3">
          {shownItems.length === 0 && (
            <p className="px-1 py-6 text-center text-[11px] leading-relaxed text-white/45">Nothing here yet. A capture is filed under the game it came from.</p>
          )}
          {shownItems.map((item) => (
            <button
              key={item.path}
              type="button"
              data-overlay
              onClick={() => void run(async () => {
                await overlayOpen(item.path);
                return `Opened ${item.name}.`;
              })}
              className="flex w-full items-center gap-2 rounded-2xl px-2 py-2 text-left hover:bg-white/10"
            >
              <Image className="size-4 shrink-0 text-white/55" />
              <span className="min-w-0">
                <span className="block truncate text-xs text-white">{item.name}</span>
                <span className="block truncate text-[11px] text-white/45">{item.game}</span>
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          data-overlay
          onClick={() => void run(async () => {
            await overlayOpenKind(tab === 'screenshot' ? 'screenshots' : tab === 'replay' ? 'replays' : 'recordings');
            return 'Opened the folder.';
          })}
          className="m-3 flex items-center justify-center gap-2 rounded-full border border-white/15 bg-black/40 px-3 py-1.5 text-[11px] text-white/75 hover:border-white/40"
        >
          <FolderOpen className="size-3.5" />
          Open folder
        </button>
      </aside>
      <div data-overlay-section="capture" className="pointer-events-auto absolute bottom-6 left-1/2 w-[min(40rem,calc(100%-3rem))] -translate-x-1/2 rounded-3xl border border-white/10 bg-[#141416]/92 px-6 py-5 shadow-2xl backdrop-blur-md">
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="truncate text-xs text-white/70">{status?.game || 'No game playing'}</p>
          <p className="shrink-0 text-[11px] tabular-nums text-white/45">{quality} · {fps} fps</p>
        </div>
        <div className="flex items-start justify-center gap-6 sm:gap-10">
          <CaptureButton
            label="Screenshot"
            disabled={busy}
            onClick={() => void run(() => overlayShot(stamp()), true)}
          >
            <Camera className="size-7" />
          </CaptureButton>
          <CaptureButton
            label={status?.recording ? 'Stop' : 'Record'}
            hot={!!status?.recording}
            disabled={busy}
            onClick={() => void run(() => overlayRecord(stamp()))}
          >
            {status?.recording ? <Square className="size-6 fill-white" /> : <Circle className="size-6 fill-white" />}
          </CaptureButton>
          <CaptureButton
            label="Last"
            disabled={busy}
            onClick={() => void run(() => overlayReplay(seconds, stamp()))}
          >
            <span className="text-2xl font-semibold tabular-nums leading-none">{seconds}</span>
          </CaptureButton>
        </div>
        <div className="mt-4 flex items-center justify-center gap-2">
          {[30, 45, 60].map((length) => (
            <button
              key={length}
              type="button"
              data-overlay
              disabled={busy}
              onClick={() => void run(() => overlayReplay(length, stamp()))}
              className={cn(
                'rounded-full border px-3 py-1 text-[11px] tabular-nums',
                seconds === length ? 'border-white bg-white text-black' : 'border-white/25 text-white/80 hover:border-white/60',
              )}
            >
              {length}s
            </button>
          ))}
          {custom && (
            <button
              type="button"
              data-overlay
              disabled={busy}
              onClick={() => void run(() => overlayReplay(seconds, stamp()))}
              className="rounded-full border border-white bg-white px-3 py-1 text-[11px] tabular-nums text-black"
            >
              {seconds}s
            </button>
          )}
        </div>
        <p className={cn('mt-3 text-center text-xs leading-relaxed', failed ? 'text-red-200' : 'text-white/75')}>{shown}</p>
      </div>
    </div>
  );
}

function CaptureButton({
  label,
  hot = false,
  disabled,
  onClick,
  children,
}: {
  label: string;
  hot?: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-overlay
      disabled={disabled}
      onClick={onClick}
      className="flex w-24 flex-col items-center gap-2 rounded-full focus:outline-none disabled:opacity-40"
    >
      <span
        className={cn(
          'grid size-[4.75rem] place-items-center rounded-full border-2 shadow-lg',
          hot ? 'border-red-500 bg-red-600 text-white' : 'border-white/80 bg-black/35 text-white',
        )}
      >
        {children}
      </span>
      <span className="text-[11px] font-medium tracking-wide text-white">{label}</span>
    </button>
  );
}

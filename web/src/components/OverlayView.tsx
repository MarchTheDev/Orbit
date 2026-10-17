import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { Camera, Circle, FolderOpen, Image, Pin, Square, X } from 'lucide-react';
import { emit, listen } from '@tauri-apps/api/event';
import { applyFont, applyTheme } from '../data/themes';
import { loadSettings } from '../services/storage';
import { fileSrc } from '../services/desktop';
import { playShutter, primeShutter } from '../services/shutter';
import {
  overlayConfigure,
  overlayFps,
  overlayGallery,
  overlayHide,
  overlayHits,
  overlayLengths,
  overlayMode,
  overlayOpen,
  overlayOpenKind,
  overlayPins,
  overlayQuality,
  overlayRecord,
  overlayReplay,
  overlayShot,
  overlayStatus,
  clampOverlaySeconds,
  type GalleryItem,
  type OverlayStatus,
} from '../services/native';
import type { Settings } from '../types';
import { cn } from '../utils/cn';
import { AppMixer } from './AppMixer';
import { MediaPlayer } from './MediaPlayer';

type BoxId = 'audio' | 'gallery' | 'capture' | 'player';
type Place = { x: number; y: number; pinned?: boolean };

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

function defaults(width: number, height: number): Record<BoxId, Place> {
  return {
    audio: { x: 24, y: 24 },
    player: { x: Math.min(width - 344, 360), y: 24 },
    gallery: { x: Math.max(24, width - 344), y: 24 },
    capture: { x: Math.max(24, (width - 640) / 2), y: Math.max(24, height - 250) },
  };
}

function placeOf(layout: NonNullable<Settings['overlay']>['layout'], id: BoxId, fallback: Place): Place {
  const saved = layout?.[id];
  if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return fallback;
  return { x: saved.x, y: saved.y, pinned: !!saved.pinned };
}

function anyPinned(places: Record<BoxId, Place>): boolean {
  return Object.values(places).some((place) => place.pinned);
}

function physicalHits(): { x: number; y: number; w: number; h: number }[] {
  const scale = window.devicePixelRatio || 1;
  return Array.from(document.querySelectorAll<HTMLElement>('[data-pin="1"]')).map((node) => {
    const rect = node.getBoundingClientRect();
    return {
      x: rect.left * scale - 8,
      y: rect.top * scale - 8,
      w: rect.width * scale + 16,
      h: rect.height * scale + 16,
    };
  });
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
  const [ready, setReady] = useState(false);
  const [resting, setResting] = useState(false);
  const [awake, setAwake] = useState(true);
  const [places, setPlaces] = useState<Record<BoxId, Place>>(() => defaults(1280, 720));
  const [shutterOn, setShutterOn] = useState(true);
  const [shutterVolume, setShutterVolume] = useState(40);
  const [front, setFront] = useState<BoxId>('capture');
  const settingsRef = useRef<Settings | null>(null);
  const placesRef = useRef(places);
  placesRef.current = places;

  const refresh = () => {
    void overlayStatus().then(setStatus).catch(() => undefined);
    void overlayGallery().then(setItems).catch(() => undefined);
  };

  const patchOverlay = (patch: Partial<NonNullable<Settings['overlay']>>) => {
    const current = settingsRef.current;
    if (current) {
      settingsRef.current = { ...current, overlay: { ...current.overlay, ...patch } };
    }
    // The main window owns the file. Writing it here as well raced that save.
    void emit('overlay-settings', patch);
  };

  const rememberLayout = async (next: Record<BoxId, Place>) => {
    setPlaces(next);
    patchOverlay({ layout: next });
    await overlayPins(anyPinned(next));
    window.setTimeout(() => void overlayHits(physicalHits()), 40);
  };

  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    const size = () => defaults(window.innerWidth, window.innerHeight);
    void Promise.all([loadSettings(), overlayMode()]).then(([settings, mode]) => {
      applyTheme(settings.theme);
      applyFont(settings.fontFamily ?? 'system');
      settingsRef.current = settings;
      const base = size();
      const layout = settings.overlay?.layout;
      const next = {
        audio: placeOf(layout, 'audio', base.audio),
        player: placeOf(layout, 'player', base.player),
        gallery: placeOf(layout, 'gallery', base.gallery),
        capture: placeOf(layout, 'capture', base.capture),
      };
      setPlaces(next);
      setShutterOn(settings.overlay?.shutter !== false);
      setShutterVolume(settings.overlay?.shutterVolume ?? 40);
      setResting(mode.resting && !mode.open);
      setAwake(mode.open || mode.resting);
      void overlayPins(anyPinned(next));
      setReady(true);
    }).catch(() => setReady(true));
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
    let stopRest = () => {};
    let stopPad = () => {};
    void listen('overlay-shown', () => {
      setAwake(true);
      setResting(false);
      refresh();
      window.setTimeout(() => {
        const next = document.querySelector('[data-overlay-section="capture"] button[data-overlay]:not([disabled])');
        if (next instanceof HTMLElement) next.focus();
      }, 30);
    }).then((unlisten) => {
      stopShown = unlisten;
    }).catch(() => undefined);
    void listen('overlay-rest', () => {
      setAwake(true);
      setResting(true);
    }).then((unlisten) => {
      stopRest = unlisten;
    }).catch(() => undefined);
    let stopHidden = () => {};
    void listen('overlay-hidden', () => {
      setAwake(false);
      setResting(false);
    }).then((unlisten) => {
      stopHidden = unlisten;
    }).catch(() => undefined);
    void listen<string>('overlay-pad', (event) => {
      const action = event.payload;
      if (action === 'back') {
        void overlayHide();
        return;
      }
      if (action === 'page-left') {
        focusSection('audio');
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
      stopRest();
      stopHidden();
      stopPad();
    };
  }, []);

  useEffect(() => {
    if (!ready || !awake) return;
    const timer = window.setInterval(() => {
      void overlayStatus().then(setStatus).catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [ready, awake]);

  useEffect(() => {
    if (!ready || !resting) return;
    const send = () => void overlayHits(physicalHits());
    send();
    const timer = window.setInterval(send, 700);
    window.addEventListener('resize', send);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('resize', send);
    };
  }, [ready, resting, places]);

  const run = async (work: () => Promise<string>, shot = false) => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      setNote(await work());
      if (shot) {
        const fresh = await loadSettings().catch(() => settingsRef.current);
        const on = fresh ? fresh.overlay?.shutter !== false : shutterOn;
        const volume = fresh?.overlay?.shutterVolume ?? shutterVolume;
        if (on) playShutter(volume);
      }
      refresh();
    } catch (error) {
      setFailed(true);
      setNote(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const chooseLength = (length: number) => {
    const seconds = clampOverlaySeconds(length);
    const overlay = settingsRef.current?.overlay;
    patchOverlay({ seconds });
    void overlayConfigure({
      enabled: overlay?.enabled !== false,
      replay: overlay?.replay !== false,
      seconds,
      quality: overlayQuality(overlay?.quality),
      fps: overlayFps(overlay?.fps),
      ffmpeg: overlay?.ffmpeg ?? '',
    });
    setStatus((current) => (current ? { ...current, seconds } : current));
  };

  const drag = (id: BoxId, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button, input, a')) return;
    event.preventDefault();
    setFront(id);
    const origin = places[id];
    const startX = event.clientX;
    const startY = event.clientY;
    const moveTo = (ev: PointerEvent) => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      setPlaces((current) => {
        const next = {
          ...current,
          [id]: {
            ...current[id],
            x: Math.min(width - 80, Math.max(8, origin.x + ev.clientX - startX)),
            y: Math.min(height - 48, Math.max(8, origin.y + ev.clientY - startY)),
          },
        };
        placesRef.current = next;
        return next;
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', moveTo);
      window.removeEventListener('pointerup', up);
      void rememberLayout(placesRef.current);
    };
    window.addEventListener('pointermove', moveTo);
    window.addEventListener('pointerup', up);
  };

  const pin = (id: BoxId) => {
    const next = { ...places, [id]: { ...places[id], pinned: !places[id].pinned } };
    void rememberLayout(next).then(() => {
      if (resting && !anyPinned(next)) void overlayHide();
    });
  };

  if (!ready) return <div className="h-full" />;

  const seconds = status?.seconds ?? 30;
  const lengths = overlayLengths(status?.lengths);
  const quality = status?.quality === '4k' ? '4K' : status?.quality || '1080p';
  const fps = status?.fps === 60 ? 60 : 30;
  const standing = !status
    ? 'Opening…'
    : status.recording
      ? 'Recording. The red button stops it. The picture keeps moving while this is open.'
      : status.playing && status.replay
        ? `Keeping the last ${seconds} seconds${status.game ? ` of ${status.game}` : ''}.`
        : 'Screenshot, record, or save the last few seconds.';
  const shown = note || status?.note || standing;
  const shownItems = items.filter((item) => item.kind === tab);
  const visible = (id: BoxId) => awake && (!resting || places[id].pinned);

  return (
    <div className="relative h-full text-white">
      {!resting && <div className="absolute inset-0 bg-black/45" onClick={() => void overlayHide()} />}
      {visible('audio') && (
        <Box
          id="audio"
          title="Audio"
          place={places.audio}
          front={front === 'audio'}
          onDrag={drag}
          onPin={pin}
          section="audio"
        >
          <p className="mb-2 text-[11px] leading-relaxed text-white/45">The game, the speakers, then one other. More opens the rest. Left and right change a volume by 1.</p>
          <AppMixer pad game={status?.game ?? ''} compact />
        </Box>
      )}
      {visible('player') && (
        <Box id="player" title="Playing" place={places.player} front={front === 'player'} onDrag={drag} onPin={pin} section="player">
          <MediaPlayer pad />
        </Box>
      )}
      {visible('gallery') && (
        <Box
          id="gallery"
          title="Gallery"
          place={places.gallery}
          front={front === 'gallery'}
          onDrag={drag}
          onPin={pin}
          section="gallery"
          extra={!resting && (
            <button
              type="button"
              data-overlay
              aria-label="Close"
              onClick={() => void overlayHide()}
              className="grid size-7 place-items-center rounded-full text-white/70 hover:bg-white/10 hover:text-white"
            >
              <X className="size-4" />
            </button>
          )}
        >
          <div className="mb-2 flex gap-1">
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
          <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto">
            {shownItems.length === 0 && (
              <p className="col-span-2 px-1 py-6 text-center text-[11px] leading-relaxed text-white/45">Nothing here yet. A capture is filed under the game it came from.</p>
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
                className="overflow-hidden rounded-2xl bg-black/30 text-left hover:bg-white/10"
              >
                <Preview item={item} />
                <span className="block truncate px-2 py-1.5 text-[11px] text-white">{item.name}</span>
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
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-full border border-white/15 bg-black/40 px-3 py-1.5 text-[11px] text-white/75 hover:border-white/40"
          >
            <FolderOpen className="size-3.5" />
            Open folder
          </button>
        </Box>
      )}
      {visible('capture') && (
        <Box
          id="capture"
          title={status?.game || 'No game playing'}
          place={places.capture}
          front={front === 'capture'}
          onDrag={drag}
          onPin={pin}
          section="capture"
          wide
          extra={!resting && (
            <button
              type="button"
              data-overlay
              aria-label="Close"
              onClick={() => void overlayHide()}
              className="grid size-7 place-items-center rounded-full text-white/70 hover:bg-white/10 hover:text-white"
            >
              <X className="size-4" />
            </button>
          )}
        >
          <p className="mb-3 text-center text-[11px] tabular-nums text-white/45">{quality} · {fps} fps</p>
          <div className="flex items-start justify-center gap-6 sm:gap-10">
            <CaptureButton label="Screenshot" disabled={busy} onClick={() => { primeShutter(); void run(() => overlayShot(stamp()), true); }}>
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
            <CaptureButton label="Last" disabled={busy} onClick={() => void run(() => overlayReplay(seconds, stamp()))}>
              <span className="text-2xl font-semibold tabular-nums leading-none">{seconds}</span>
            </CaptureButton>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {lengths.map((length) => (
              <button
                key={length}
                type="button"
                data-overlay
                disabled={busy}
                onClick={() => void chooseLength(length)}
                className={cn(
                  'rounded-full border px-3 py-1 text-[11px] tabular-nums',
                  seconds === length ? 'border-white bg-white text-black' : 'border-white/25 text-white/80 hover:border-white/60',
                )}
              >
                {length}s
              </button>
            ))}
          </div>
          <p className={cn('mt-3 text-center text-xs leading-relaxed', failed ? 'text-red-200' : 'text-white/75')}>{shown}</p>
          {!resting && <p className="mt-1 text-center text-[11px] text-white/40">Drag a title to move a box. Pin keeps it on screen after this closes.</p>}
        </Box>
      )}
    </div>
  );
}

function Box({
  id,
  title,
  place,
  front,
  onDrag,
  onPin,
  section,
  wide = false,
  extra,
  children,
}: {
  id: BoxId;
  title: string;
  place: Place;
  front: boolean;
  onDrag: (id: BoxId, event: ReactPointerEvent<HTMLElement>) => void;
  onPin: (id: BoxId) => void;
  section: string;
  wide?: boolean;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <aside
      data-overlay-section={section}
      data-pin={place.pinned ? '1' : '0'}
      className={cn(
        'pointer-events-auto absolute flex max-h-[calc(100%-3rem)] flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#141416]/92 text-fg shadow-2xl backdrop-blur-md',
        wide ? 'w-[min(40rem,calc(100%-3rem))]' : 'w-80',
      )}
      style={{ left: place.x, top: place.y, zIndex: front ? 30 : 20 }}
    >
      <div
        className="flex cursor-grab items-center justify-between gap-2 px-4 pt-3 active:cursor-grabbing"
        onPointerDown={(event) => onDrag(id, event)}
      >
        <p className="min-w-0 truncate text-[11px] uppercase tracking-widest text-white/50">{title}</p>
        <span className="flex items-center gap-1">
          {extra}
          <button
            type="button"
            data-overlay
            aria-label={place.pinned ? `Unpin ${title}` : `Pin ${title}`}
            aria-pressed={place.pinned}
            onClick={() => onPin(id)}
            className={cn(
              'grid size-7 place-items-center rounded-full',
              place.pinned ? 'bg-white text-black' : 'text-white/70 hover:bg-white/10 hover:text-white',
            )}
          >
            <Pin className="size-3.5" />
          </button>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-2">{children}</div>
    </aside>
  );
}

function Preview({ item }: { item: GalleryItem }) {
  const src = fileSrc(item.path);
  const [failed, setFailed] = useState(false);
  if (failed || !src) {
    return (
      <span className="grid h-20 place-items-center bg-white/5 text-white/40">
        <Image className="size-4" />
      </span>
    );
  }
  if (item.kind === 'screenshot') {
    return <img src={src} alt="" className="h-20 w-full object-cover" draggable={false} onError={() => setFailed(true)} />;
  }
  return (
    <video
      src={`${src}#t=0.2`}
      muted
      preload="metadata"
      playsInline
      className="h-20 w-full object-cover"
      onLoadedData={(event) => {
        const video = event.currentTarget;
        if (video.currentTime < 0.1) video.currentTime = 0.2;
      }}
      onError={() => setFailed(true)}
    />
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

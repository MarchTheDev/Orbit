import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { Camera, Circle, Copy, ExternalLink, FolderOpen, Image, Pin, RotateCcw, Settings2, Sparkles, Square, Trash2, Video, X } from 'lucide-react';
import { emit, listen } from '@tauri-apps/api/event';
import { applyFont, applyTheme } from '../data/themes';
import { loadSettings } from '../services/storage';
import { fileSrc } from '../services/desktop';
import { playShutter, primeShutter } from '../services/shutter';
import {
  overlayConfigure,
  overlayFps,
  overlayGallery,
  overlayDelete,
  overlayCopy,
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
  overlayOpenSettings,
  revealInExplorer,
  appendPlaythroughNotes,
  machineStats,
  clampOverlaySeconds,
  type GalleryItem,
  type MachineStats,
  type OverlayStatus,
} from '../services/native';
import { OVERLAY_BOXES, type OverlayBoxId, type Settings } from '../types';
import { cn } from '../utils/cn';
import { ContextMenu, type MenuItem } from './ui/ContextMenu';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { AppMixer } from './AppMixer';
import { MediaPlayer } from './MediaPlayer';

type BoxId = OverlayBoxId;
type Place = { x: number; y: number; w?: number; h?: number; pinned?: boolean };
type GalleryMenuState = { x: number; y: number; item: GalleryItem };
type OverlayToastKind = 'screenshot' | 'recording' | 'replay' | 'gallery' | 'ready';
type OverlayToast = { title: string; detail: string; kind: OverlayToastKind };
const PAGE_SIZE = 4;
const LAYOUT_REVISION = 4;
const BOX: Record<BoxId, { w: number; h: number; minW: number; minH: number }> = {
  fps: { w: 176, h: 112, minW: 120, minH: 88 },
  clock: { w: 176, h: 112, minW: 120, minH: 88 },
  audio: { w: 300, h: 440, minW: 220, minH: 160 },
  performance: { w: 240, h: 196, minW: 200, minH: 140 },
  gallery: { w: 320, h: 360, minW: 240, minH: 180 },
  player: { w: 320, h: 268, minW: 240, minH: 180 },
  notes: { w: 300, h: 210, minW: 220, minH: 140 },
  capture: { w: 560, h: 220, minW: 320, minH: 160 },
};

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
  const edge = 24;
  const gap = 16;
  const fps = { x: edge, y: edge, w: BOX.fps.w, h: BOX.fps.h };
  const clock = { x: edge, y: fps.y + BOX.fps.h + gap, w: BOX.clock.w, h: BOX.clock.h };
  const audioY = clock.y + BOX.clock.h + gap;
  const audio = {
    x: edge,
    y: audioY,
    w: BOX.audio.w,
    h: Math.max(BOX.audio.minH, Math.min(BOX.audio.h, height - audioY - edge)),
  };
  const performance = {
    x: edge + BOX.audio.w + gap,
    y: edge,
    w: BOX.performance.w,
    h: BOX.performance.h,
  };
  const gallery = {
    x: Math.max(edge, width - BOX.gallery.w - edge),
    y: edge,
    w: BOX.gallery.w,
    h: BOX.gallery.h,
  };
  const player = {
    x: Math.max(edge, width - BOX.player.w - edge),
    y: Math.max(edge, Math.min(height - BOX.player.h - edge, gallery.y + BOX.gallery.h + gap)),
    w: BOX.player.w,
    h: BOX.player.h,
  };
  const notes = {
    x: performance.x,
    y: performance.y + BOX.performance.h + gap,
    w: BOX.notes.w,
    h: BOX.notes.h,
  };
  const capture = {
    x: Math.max(edge, Math.round((width - BOX.capture.w) / 2)),
    y: Math.max(edge, height - BOX.capture.h - edge),
    w: BOX.capture.w,
    h: BOX.capture.h,
  };
  return { fps, clock, audio, performance, gallery, player, notes, capture };
}

function placeOf(layout: NonNullable<Settings['overlay']>['layout'], id: BoxId, fallback: Place): Place {
  const saved = layout?.[id];
  if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return fallback;
  const w = Number.isFinite(saved.w) ? Math.max(BOX[id].minW, saved.w as number) : fallback.w;
  const h = Number.isFinite(saved.h) ? Math.max(BOX[id].minH, saved.h as number) : fallback.h;
  return { x: saved.x, y: saved.y, w, h, pinned: !!saved.pinned };
}

function anyPinned(places: Record<BoxId, Place>, hidden: BoxId[]): boolean {
  return (Object.entries(places) as [BoxId, Place][]).some(([id, place]) => place.pinned && !hidden.includes(id));
}

function gigabytes(bytes: number, roundTotal = false): string {
  if (!bytes) return '0';
  const value = bytes / 1024 / 1024 / 1024;
  if (roundTotal) return String(Math.round(value));
  return value >= 10 ? value.toFixed(0) : value.toFixed(1);
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
  const [hidden, setHidden] = useState<BoxId[]>([]);
  const [shutterOn, setShutterOn] = useState(true);
  const [shutterVolume, setShutterVolume] = useState(40);
  const [front, setFront] = useState<BoxId>('capture');
  const [page, setPage] = useState(0);
  const [boxesOpen, setBoxesOpen] = useState(false);
  const [stats, setStats] = useState<MachineStats | null>(null);
  const [draft, setDraft] = useState('');
  const [noteError, setNoteError] = useState('');
  const [clock, setClock] = useState(() => new Date());
  const [toast, setToast] = useState<OverlayToast | null>(null);
  const [galleryMenu, setGalleryMenu] = useState<GalleryMenuState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GalleryItem | null>(null);
  const [galleryError, setGalleryError] = useState('');
  const settingsRef = useRef<Settings | null>(null);
  const toastTimer = useRef(0);
  const placesRef = useRef(places);
  const hiddenRef = useRef(hidden);
  const lastResizePress = useRef<{ id: BoxId; time: number; x: number; y: number } | null>(null);
  const gameKey = useRef('');
  placesRef.current = places;
  hiddenRef.current = hidden;

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
    patchOverlay({ layout: next, layoutRevision: LAYOUT_REVISION });
    await overlayPins(anyPinned(next, hiddenRef.current));
    window.setTimeout(() => void overlayHits(physicalHits()), 40);
  };

  const flash = (title: string, detail: string, kind: OverlayToastKind = 'screenshot') => {
    if (settingsRef.current?.overlay?.captureToast === false) return;
    setToast({ title, detail, kind });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4200);
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
      const revision = settings.overlay?.layoutRevision ?? 0;
      const savedAudio = placeOf(layout, 'audio', base.audio);
      const audio = revision < LAYOUT_REVISION && layout?.audio?.h === 300
        ? { ...savedAudio, h: Math.max(BOX.audio.minH, Math.min(BOX.audio.h, window.innerHeight - savedAudio.y - 24)) }
        : savedAudio;
      const next = revision >= LAYOUT_REVISION
        ? {
            fps: placeOf(layout, 'fps', base.fps),
            performance: placeOf(layout, 'performance', base.performance),
            clock: placeOf(layout, 'clock', base.clock),
            notes: placeOf(layout, 'notes', base.notes),
            audio,
            player: placeOf(layout, 'player', base.player),
            gallery: placeOf(layout, 'gallery', base.gallery),
            capture: placeOf(layout, 'capture', base.capture),
          }
        : revision === 3
          ? {
              fps: placeOf(layout, 'fps', base.fps),
              performance: placeOf(layout, 'performance', base.performance),
              clock: placeOf(layout, 'clock', base.clock),
              notes: placeOf(layout, 'notes', base.notes),
              audio,
              player: placeOf(layout, 'player', base.player),
              gallery: placeOf(layout, 'gallery', base.gallery),
              capture: placeOf(layout, 'capture', base.capture),
            }
          : revision === 2
            ? {
                fps: placeOf(layout, 'fps', base.fps),
                performance: placeOf(layout, 'performance', base.performance),
                clock: { ...base.clock, pinned: !!layout?.clock?.pinned },
                notes: placeOf(layout, 'notes', base.notes),
                audio,
                player: placeOf(layout, 'player', base.player),
                gallery: placeOf(layout, 'gallery', base.gallery),
                capture: placeOf(layout, 'capture', base.capture),
              }
            : (Object.fromEntries((Object.keys(base) as BoxId[]).map((id) => [id, { ...base[id], pinned: !!layout?.[id]?.pinned }])) as Record<BoxId, Place>);
      if (revision < LAYOUT_REVISION) {
        settingsRef.current = { ...settings, overlay: { ...settings.overlay, layout: next, layoutRevision: LAYOUT_REVISION } };
        patchOverlay({ layout: next, layoutRevision: LAYOUT_REVISION });
      }
      const hiddenBoxes = (settings.overlay?.hidden ?? []).filter((id): id is BoxId => OVERLAY_BOXES.some((box) => box.id === id));
      setPlaces(next);
      setHidden(hiddenBoxes);
      setShutterOn(settings.overlay?.shutter !== false);
      setShutterVolume(settings.overlay?.shutterVolume ?? 40);
      setResting(mode.resting && !mode.open);
      setAwake(mode.open || mode.resting);
      void overlayPins(anyPinned(next, hiddenBoxes));
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
      void loadSettings().then((settings) => {
        settingsRef.current = settings;
        const hiddenBoxes = (settings.overlay?.hidden ?? []).filter((id): id is BoxId => OVERLAY_BOXES.some((box) => box.id === id));
        setHidden(hiddenBoxes);
        hiddenRef.current = hiddenBoxes;
        setShutterOn(settings.overlay?.shutter !== false);
        setShutterVolume(settings.overlay?.shutterVolume ?? 40);
      }).catch(() => undefined);
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
      window.clearTimeout(toastTimer.current);
    };
  }, []);

  useEffect(() => {
    const title = status?.readyNotice;
    if (!title) return;
    setToast({ title: 'Game started', detail: `${title} is running. Press Alt+X to open Orbit Overlay.`, kind: 'ready' });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4200);
  }, [status?.readyNotice]);

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

  const run = async (work: () => Promise<unknown>, shot = false, done = '') => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    setNote('');
    try {
      const result = await work();
      if (shot) {
        const fresh = await loadSettings().catch(() => settingsRef.current);
        const on = fresh ? fresh.overlay?.shutter !== false : shutterOn;
        const volume = fresh?.overlay?.shutterVolume ?? shutterVolume;
        if (on) playShutter(volume);
      }
      if (done) {
        const saved = /saved/i.test(done);
        const copyFailed = typeof result === 'string' && result.toLowerCase().includes('clipboard copy failed');
        const detail = saved
          ? copyFailed ? 'Saved to Gallery · clipboard copy was not available' : 'Saved to Gallery · copied to clipboard'
          : 'Your recording is underway';
        const kind: OverlayToastKind = /recording/i.test(done)
          ? 'recording'
          : /replay/i.test(done)
            ? 'replay'
            : 'screenshot';
        flash(done, detail, kind);
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
      screenshotDirectory: overlay?.screenshotDirectory ?? '',
      recordingDirectory: overlay?.recordingDirectory ?? '',
      replayDirectory: overlay?.replayDirectory ?? '',
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

  const resize = (id: BoxId, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const now = Date.now();
    const previous = lastResizePress.current;
    if (previous?.id === id && now - previous.time <= 450 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 8) {
      lastResizePress.current = null;
      event.preventDefault();
      setFront(id);
      resetSize(id);
      return;
    }
    lastResizePress.current = { id, time: now, x: event.clientX, y: event.clientY };
    event.preventDefault();
    setFront(id);
    const origin = placesRef.current[id];
    const startX = event.clientX;
    const startY = event.clientY;
    const startW = origin.w ?? BOX[id].w;
    const startH = origin.h ?? BOX[id].h;
    const moveTo = (ev: PointerEvent) => {
      if (lastResizePress.current?.id === id && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 8) {
        lastResizePress.current = null;
      }
      const min = BOX[id];
      const w = Math.round(Math.min(window.innerWidth - 16, Math.max(min.minW, startW + ev.clientX - startX)));
      const h = Math.round(Math.min(window.innerHeight - 16, Math.max(min.minH, startH + ev.clientY - startY)));
      setPlaces((current) => {
        const next = { ...current, [id]: { ...current[id], w, h } };
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

  const resetSize = (id: BoxId) => {
    const current = placesRef.current;
    const base = defaults(window.innerWidth, window.innerHeight)[id];
    const next = { ...current, [id]: { ...current[id], w: base.w, h: base.h } };
    placesRef.current = next;
    void rememberLayout(next);
  };

  const pin = (id: BoxId) => {
    const next = { ...places, [id]: { ...places[id], pinned: !places[id].pinned } };
    void rememberLayout(next).then(() => {
      if (resting && !anyPinned(next, hiddenRef.current)) void overlayHide();
    });
  };

  useEffect(() => {
    if (!status) return;
    const key = status.playing ? status.game : '';
    if (gameKey.current === '' && key !== '') {
      gameKey.current = key;
      return;
    }
    if (key === gameKey.current) return;
    gameKey.current = key;
    setDraft('');
    setNoteError('');
  }, [status]);

  const wantFps = awake && !hidden.includes('fps') && (!resting || !!places.fps.pinned);
  const wantPerformance = awake && !hidden.includes('performance') && (!resting || !!places.performance.pinned);
  const wantStats = wantFps || wantPerformance;
  useEffect(() => {
    if (!wantStats) return;
    const pull = () => void machineStats(wantFps).then(setStats).catch(() => undefined);
    pull();
    const timer = window.setInterval(pull, 1000);
    return () => window.clearInterval(timer);
  }, [wantStats, wantFps]);

  useEffect(() => {
    const count = items.filter((item) => item.kind === tab).length;
    const last = Math.max(0, Math.ceil(count / PAGE_SIZE) - 1);
    setPage((current) => (current > last ? last : current));
  }, [items, tab]);

  const wantClock = awake && !hidden.includes('clock') && (!resting || places.clock.pinned);
  useEffect(() => {
    if (!wantClock) return;
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, [wantClock]);

  if (!ready) return <div className="h-full" />;

  const seconds = status?.seconds ?? 30;
  const lengths = overlayLengths(status?.lengths);
  const quality = status?.quality === '4k' ? '4K' : status?.quality || '1080p';
  const fps = status?.fps === 60 ? 60 : 30;
  const shownItems = items.filter((item) => item.kind === tab);
  const pages = Math.max(1, Math.ceil(shownItems.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const pageItems = shownItems.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const visible = (id: BoxId) => awake && !hidden.includes(id) && (!resting || !!places[id]?.pinned);
  const toggleBox = (id: BoxId) => {
    const next = hidden.includes(id) ? hidden.filter((item) => item !== id) : [...hidden, id];
    setHidden(next);
    hiddenRef.current = next;
    patchOverlay({ hidden: next });
    void overlayPins(anyPinned(placesRef.current, next));
  };
  const saveNote = () => {
    const text = draft.trim();
    if (!text) return;
    setNoteError('');
    void appendPlaythroughNotes(text).then(() => {
      setDraft('');
    }).catch((error) => {
      setNoteError(error instanceof Error ? error.message : String(error));
    });
  };

  const ToastIcon = toast ? ({
    screenshot: Camera,
    recording: Video,
    replay: RotateCcw,
    gallery: Copy,
    ready: Sparkles,
  })[toast.kind] : null;
  const toastLabel = toast ? ({
    screenshot: 'ORBIT · SCREENSHOT',
    recording: 'ORBIT · RECORDING',
    replay: 'ORBIT · REPLAY',
    gallery: 'ORBIT · GALLERY',
    ready: 'ORBIT · READY',
  })[toast.kind] : '';
  const toastStateLabel = toast?.kind === 'recording' && /started/i.test(toast.title)
    ? 'LIVE'
    : toast?.kind === 'ready'
      ? 'READY'
      : toast?.kind === 'gallery'
        ? 'COPIED'
        : 'SAVED';

  return (
    <div className="relative h-full text-white">
      {!resting && <div className="absolute inset-0 bg-black/45" onClick={() => void overlayHide()} />}
      {toast && ToastIcon && (
        <div className="pointer-events-none fixed inset-x-0 top-12 z-[100] flex justify-center px-4">
          <div
            role="status"
            aria-live="polite"
            className={cn('orbit-toast orbit-toast-card relative flex w-full max-w-[26rem] items-center gap-3.5 overflow-hidden rounded-[1.25rem] border px-4 py-3.5 text-white shadow-2xl backdrop-blur-2xl', `orbit-toast-card--${toast.kind}`)}
          >
            <span className="orbit-toast-orbit pointer-events-none absolute -right-5 -top-8 z-0 size-24 rounded-full border" aria-hidden="true" />
            <span className="orbit-toast-icon relative z-10 grid size-11 shrink-0 place-items-center rounded-2xl border">
              <ToastIcon className="size-[19px]" aria-hidden="true" />
              <span className="orbit-toast-indicator absolute -right-0.5 -top-0.5 size-2 rounded-full border-2 border-[#11101b]" aria-hidden="true" />
            </span>
            <span className="relative z-10 min-w-0 flex-1">
              <span className="mb-1 flex min-w-0 items-center gap-1.5">
                <span className="orbit-toast-kicker truncate text-[9px] font-bold uppercase tracking-[.18em]">{toastLabel}</span>
                <span className="size-1 shrink-0 rounded-full bg-white/30" aria-hidden="true" />
                <span className="shrink-0 text-[9px] font-semibold uppercase tracking-[.12em] text-white/45">{toastStateLabel}</span>
              </span>
              <span className="block truncate text-sm font-semibold">{toast.title}</span>
              <span className="mt-0.5 block truncate text-[11px] text-white/60">{toast.detail}</span>
            </span>
            <span className="orbit-toast-progress absolute inset-x-0 bottom-0 z-20 h-[2px] origin-left" aria-hidden="true" />
          </div>
        </div>
      )}
      {visible('audio') && (
        <Box
          id="audio"
          title="Audio"
          scroll
          place={places.audio}
          front={front === 'audio'}
          onDrag={drag}
          onResize={resize}
          onPin={pin}
          section="audio"
        >
          <p className="mb-2 text-[11px] leading-relaxed text-white/45">Up to three active sources are shown. More opens the rest; left and right change a volume by 1.</p>
          <AppMixer pad game={status?.game ?? ''} compact onMore={() => setFront('audio')} />
        </Box>
      )}
      {visible('player') && (
        <Box id="player" title="Playing" place={places.player} front={front === 'player'} onDrag={drag} onResize={resize} onPin={pin} section="player">
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
          onResize={resize}
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
                onClick={() => { setTab(kind); setPage(0); }}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[11px]',
                  tab === kind ? 'border-white bg-white text-black' : 'border-white/20 text-white/75 hover:border-white/50',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {shownItems.length === 0 && (
              <p className="col-span-2 px-1 py-6 text-center text-[11px] leading-relaxed text-white/45">Nothing here yet. A capture is filed under the game it came from.</p>
            )}
            {pageItems.map((item) => (
              <button
                key={item.path}
                type="button"
                data-overlay
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setGalleryMenu({ x: event.clientX, y: event.clientY, item });
                  setFront('gallery');
                }}
                onClick={() => void run(async () => { await overlayOpen(item.path); })}
                className="overflow-hidden rounded-2xl bg-black/30 text-left hover:bg-white/10"
              >
                <Preview item={item} />
                <span className="block truncate px-2 py-1.5 text-[11px] text-white">{item.name}</span>
              </button>
            ))}
          </div>
          {pages > 1 && (
            <div className="mt-2 flex items-center justify-between gap-2">
              <button
                type="button"
                data-overlay
                disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)}
                className="rounded-full border border-white/20 px-3 py-1 text-[11px] text-white/80 disabled:opacity-30"
              >
                Previous
              </button>
              <span className="text-[11px] tabular-nums text-white/50">{safePage + 1} / {pages}</span>
              <button
                type="button"
                data-overlay
                disabled={safePage >= pages - 1}
                onClick={() => setPage(safePage + 1)}
                className="rounded-full border border-white/20 px-3 py-1 text-[11px] text-white/80 disabled:opacity-30"
              >
                Next
              </button>
            </div>
          )}
          {galleryError && <p role="alert" className="mt-2 text-[11px] text-red-200">{galleryError}</p>}
          <button
            type="button"
            data-overlay
            onClick={() => void run(async () => {
              await overlayOpenKind(tab === 'screenshot' ? 'screenshots' : tab === 'replay' ? 'replays' : 'recordings');
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
          onResize={resize}
          onPin={pin}
          section="capture"
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
          <p className="mb-2 text-center text-[11px] tabular-nums text-white/45">{quality} · {fps} fps</p>
          <div className="flex items-start justify-center gap-6 sm:gap-10">
            <CaptureButton label="Screenshot" disabled={busy} onClick={() => { primeShutter(); void run(() => overlayShot(stamp()), true, 'Screenshot saved'); }}>
              <Camera className="size-7" />
            </CaptureButton>
            <CaptureButton
              label={status?.recording ? 'Stop' : 'Record'}
              hot={!!status?.recording}
              disabled={busy}
              onClick={() => void run(() => overlayRecord(stamp()), false, status?.recording ? 'Recording saved' : 'Recording started')}
            >
              {status?.recording ? <Square className="size-6 fill-white" /> : <Circle className="size-6 fill-white" />}
            </CaptureButton>
            <CaptureButton label="Last" disabled={busy} onClick={() => void run(() => overlayReplay(seconds, stamp()), false, 'Replay saved')}>
              <span className="text-2xl font-semibold tabular-nums leading-none">{seconds}</span>
            </CaptureButton>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
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
          {failed && note && <p className="mt-3 text-center text-xs leading-relaxed text-red-200">{note}</p>}
        </Box>
      )}
      {visible('fps') && (
        <Box id="fps" title="FPS" place={places.fps} front={front === 'fps'} onDrag={drag} onResize={resize} onPin={pin} section="fps">
          <p className="text-center text-4xl font-semibold tabular-nums leading-none">{stats?.fps ?? '—'}</p>
        </Box>
      )}
      {visible('performance') && (
        <Box id="performance" title="Performance" place={places.performance} front={front === 'performance'} onDrag={drag} onResize={resize} onPin={pin} section="performance">
          <Meter label="GPU" value={stats?.gpu} />
          <Meter label="CPU" value={stats?.cpu} />
          <Meter label="RAM" value={stats?.ram} detail={stats ? `${gigabytes(stats.ramUsed)} / ${gigabytes(stats.ramTotal)} GB` : ''} />
          <Meter label="VRAM" value={stats?.vram} detail={stats ? `${gigabytes(stats.vramUsed)} / ${gigabytes(stats.vramTotal, true)} GB` : ''} />
        </Box>
      )}
      {visible('clock') && (
        <Box id="clock" title="Clock" place={places.clock} front={front === 'clock'} onDrag={drag} onResize={resize} onPin={pin} section="clock">
          <p className="truncate text-center text-4xl font-semibold tabular-nums leading-none">{clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
        </Box>
      )}
      {visible('notes') && (
        <Box id="notes" title="Notes" place={places.notes} front={front === 'notes'} onDrag={drag} onResize={resize} onPin={pin} section="notes">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={4}
            placeholder={status?.playing ? 'These go away when the game closes.' : 'Start the game to keep a note.'}
            className="w-full resize-none rounded-2xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/35"
          />
          <button
            type="button"
            data-overlay
            disabled={!draft.trim() || !status?.playing}
            onClick={saveNote}
            className="mt-2 w-full rounded-full border border-white/20 px-3 py-1.5 text-[11px] text-white/80 disabled:opacity-30"
          >
            Save to journal
          </button>
          {noteError && <p className="mt-1 text-[11px] text-red-200">{noteError}</p>}
        </Box>
      )}
      {!resting && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-40 -translate-x-1/2">
          <button
            type="button"
            data-overlay
            aria-expanded={boxesOpen}
            onClick={() => setBoxesOpen((open) => !open)}
            className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-white/15 bg-[#141416]/92 px-3 py-1.5 text-[11px] text-white/80 backdrop-blur-md"
          >
            <Settings2 className="size-3.5" />
            Boxes
          </button>
          {boxesOpen && (
            <div className="pointer-events-auto absolute left-1/2 top-full z-40 mt-2 w-56 -translate-x-1/2 rounded-3xl border border-white/10 bg-[#141416]/95 p-3 shadow-2xl backdrop-blur-md">
              <div className="flex flex-wrap gap-1.5">
                {OVERLAY_BOXES.map((box) => {
                  const shown = !hidden.includes(box.id);
                  return (
                    <button
                      key={box.id}
                      type="button"
                      data-overlay
                      aria-pressed={shown}
                      onClick={() => toggleBox(box.id)}
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-[11px]',
                        shown ? 'border-white bg-white text-black' : 'border-white/20 text-white/60',
                      )}
                    >
                      {box.label}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                data-overlay
                onClick={() => void overlayOpenSettings()}
                className="mt-3 w-full rounded-full border border-white/20 px-3 py-1.5 text-[11px] text-white/80"
              >
                Open settings
              </button>
            </div>
          )}
        </div>
      )}
      {galleryMenu && (
        <ContextMenu
          x={galleryMenu.x}
          y={galleryMenu.y}
          onClose={() => setGalleryMenu(null)}
          items={[
            { label: 'Open', icon: ExternalLink, onSelect: () => void overlayOpen(galleryMenu.item.path).then(() => setGalleryError('')).catch((error) => setGalleryError(error instanceof Error ? error.message : String(error))) },
            { label: 'Open path', icon: FolderOpen, onSelect: () => void revealInExplorer(galleryMenu.item.path).then(() => setGalleryError('')).catch((error) => setGalleryError(error instanceof Error ? error.message : String(error))) },
            ...(galleryMenu.item.kind === 'screenshot' ? [{ label: 'Copy image', icon: Copy, onSelect: () => void overlayCopy(galleryMenu.item.path).then(() => { setGalleryError(''); flash('Image copied to clipboard', 'Ready to paste.', 'gallery'); }).catch((error) => setGalleryError(error instanceof Error ? error.message : String(error))) }] : []),
            { kind: 'sep' },
            { label: 'Delete…', icon: Trash2, danger: true, onSelect: () => setDeleteTarget(galleryMenu.item) },
          ] as MenuItem[]}
        />
      )}
      {deleteTarget && (
        <ConfirmDialog
          title="Delete this capture?"
          description={`Delete “${deleteTarget.name}” from Orbit's Gallery? This cannot be undone.`}
          confirmLabel="Delete capture"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            const target = deleteTarget;
            setDeleteTarget(null);
            void overlayDelete(target.path).then(() => { setGalleryError(''); refresh(); }).catch((error) => setGalleryError(error instanceof Error ? error.message : String(error)));
          }}
        />
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
  onResize,
  onPin,
  section,
  extra,
  scroll = false,
  children,
}: {
  id: BoxId;
  title: string;
  place: Place;
  front: boolean;
  onDrag: (id: BoxId, event: ReactPointerEvent<HTMLElement>) => void;
  onResize: (id: BoxId, event: ReactPointerEvent<HTMLElement>) => void;
  onPin: (id: BoxId) => void;
  section: string;
  extra?: ReactNode;
  scroll?: boolean;
  children: ReactNode;
}) {
  return (
    <aside
      data-overlay-section={section}
      data-pin={place.pinned ? '1' : '0'}
      className="pointer-events-auto absolute flex flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#141416]/92 text-fg shadow-2xl backdrop-blur-md"
      style={{ left: place.x, top: place.y, width: place.w ?? BOX[id].w, height: place.h ?? BOX[id].h, zIndex: front ? 30 : 20 }}
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
      <div className={cn('min-h-0 flex-1 px-4 pb-4 pt-2', scroll ? 'overflow-y-auto' : 'overflow-hidden')}>{children}</div>
      <div
        role="separator"
        aria-orientation="horizontal"
        title="Resize · double-click to restore default size"
        aria-label={`Resize ${title}; double-click to restore its default size`}
        onPointerDown={(event) => onResize(id, event)}
        className="absolute bottom-1.5 right-1.5 size-3.5 cursor-nwse-resize rounded-sm border-b-2 border-r-2 border-white/40 hover:border-white"
      />
    </aside>
  );
}

function Meter({ label, value, detail = '' }: { label: string; value: number | null | undefined; detail?: string }) {
  const shown = value == null ? '—' : `${value}%`;
  return (
    <div className="mb-1.5">
      <div className="flex items-baseline justify-between gap-2 text-[10px] leading-tight">
        <span className="text-white/50">{label}</span>
        <span className="tabular-nums text-white">{shown}</span>
      </div>
      <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-white/80 transition-[width] duration-300 ease-out" style={{ width: `${Math.min(100, value ?? 0)}%` }} />
      </div>
      {detail && <p className="mt-0.5 text-[9px] leading-tight tabular-nums text-white/40">{detail}</p>}
    </div>
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

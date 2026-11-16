import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { Game } from '../../types';
import { revealInExplorer, type GalleryItem } from '../../services/native';
import { fileSrc } from '../../services/desktop';
import { Cover } from './Cover';

export function formatCaptureSize(item: GalleryItem): string {
  const bytes = item.bytes ?? 0;
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatCaptureWhen(item: GalleryItem): string {
  if (!item.at) return '';
  const then = new Date(item.at * 1000);
  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const time = then.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (sameDay(then, now)) return `Today, ${time}`;
  if (sameDay(then, yesterday)) return `Yesterday, ${time}`;
  const sameYear = then.getFullYear() === now.getFullYear();
  return `${then.toLocaleDateString([], { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })}, ${time}`;
}

function fmtVideoClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  const hrs = Math.floor(whole / 3600);
  const mins = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

const PLAYBACK_RATES = [0.5, 1, 1.25, 1.5, 2] as const;

function OrbitVideoPlayer({ src, title }: { src: string; title: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | null>(null);

  const [playing, setPlaying] = useState(true);
  const [ended, setEnded] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [scrubbing, setScrubbing] = useState(false);
  const [hoverTime, setHoverTime] = useState<{ pct: number; secs: number } | null>(null);

  const bumpControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      const vid = videoRef.current;
      if (vid && !vid.paused && !scrubbing) {
        setControlsVisible(false);
      }
    }, 2200);
  }, [scrubbing]);

  useEffect(() => {
    bumpControls();
    return () => {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    };
  }, [bumpControls, src]);

  useEffect(() => {
    const onFs = () => {
      setIsFullscreen(document.fullscreenElement === wrapRef.current);
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const togglePlay = useCallback(() => {
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.ended) {
      vid.currentTime = 0;
      void vid.play().catch(() => undefined);
    } else if (vid.paused) {
      void vid.play().catch(() => undefined);
    } else {
      vid.pause();
    }
    bumpControls();
  }, [bumpControls]);

  const toggleMute = useCallback(() => {
    const vid = videoRef.current;
    if (!vid) return;
    const next = !vid.muted;
    vid.muted = next;
    setMuted(next);
    bumpControls();
  }, [bumpControls]);

  const changeVolume = useCallback((next: number) => {
    const vid = videoRef.current;
    if (!vid) return;
    const clamped = Math.max(0, Math.min(1, next));
    vid.volume = clamped;
    vid.muted = clamped === 0;
    setVolume(clamped);
    setMuted(clamped === 0);
  }, []);

  const cycleRate = useCallback(() => {
    const vid = videoRef.current;
    if (!vid) return;
    const idx = PLAYBACK_RATES.indexOf(rate as (typeof PLAYBACK_RATES)[number]);
    const next = PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length];
    vid.playbackRate = next;
    setRate(next);
    bumpControls();
  }, [rate, bumpControls]);

  const toggleFullscreen = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) {
      void document.exitFullscreen?.().catch(() => undefined);
    } else {
      void el.requestFullscreen?.().catch(() => undefined);
    }
  }, []);

  const seekAtClientX = useCallback(
    (clientX: number) => {
      const bar = trackRef.current;
      const vid = videoRef.current;
      if (!bar || !vid || !Number.isFinite(vid.duration) || vid.duration <= 0) return;
      const rect = bar.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
      const target = pct * vid.duration;
      vid.currentTime = target;
      setCurrentTime(target);
      setEnded(false);
    },
    [],
  );

  useEffect(() => {
    if (!scrubbing) return;
    const onMove = (e: PointerEvent) => seekAtClientX(e.clientX);
    const onUp = () => setScrubbing(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [scrubbing, seekAtClientX]);

  // Video keyboard shortcuts inside the viewer (capture phase handled alongside Escape/Arrows)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;
      if (e.key === ' ' || e.key.toLowerCase() === 'k') {
        e.preventDefault();
        e.stopPropagation();
        togglePlay();
      } else if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        e.stopPropagation();
        toggleMute();
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        e.stopPropagation();
        toggleFullscreen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, toggleMute, toggleFullscreen]);

  const progressPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const bufferedPct = duration > 0 ? Math.min(100, (bufferedEnd / duration) * 100) : 0;
  const effectiveVolume = muted ? 0 : volume;
  const VolumeIcon = effectiveVolume === 0 ? VolumeX : effectiveVolume < 0.5 ? Volume1 : Volume2;

  return (
    <div
      ref={wrapRef}
      className={`orbit-vplayer ${!playing || ended || controlsVisible || scrubbing ? 'is-awake' : 'is-idle'}`}
      onMouseMove={bumpControls}
      onMouseLeave={() => {
        if (playing && !scrubbing) setControlsVisible(false);
      }}
    >
      <video
        ref={videoRef}
        src={src}
        autoPlay
        playsInline
        aria-label={title}
        className="orbit-vplayer-surface"
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        onPlay={() => {
          setPlaying(true);
          setEnded(false);
          bumpControls();
        }}
        onPause={() => {
          setPlaying(false);
          setControlsVisible(true);
        }}
        onEnded={() => {
          setPlaying(false);
          setEnded(true);
          setControlsVisible(true);
        }}
        onLoadedMetadata={(e) => {
          const vid = e.currentTarget;
          setDuration(vid.duration || 0);
          setVolume(vid.volume);
          setMuted(vid.muted);
        }}
        onTimeUpdate={(e) => {
          const vid = e.currentTarget;
          if (!scrubbing) setCurrentTime(vid.currentTime);
          if (vid.buffered.length > 0) {
            setBufferedEnd(vid.buffered.end(vid.buffered.length - 1));
          }
        }}
        onProgress={(e) => {
          const vid = e.currentTarget;
          if (vid.buffered.length > 0) {
            setBufferedEnd(vid.buffered.end(vid.buffered.length - 1));
          }
        }}
      />

      {(!playing || ended) && (
        <button
          type="button"
          onClick={togglePlay}
          aria-label={ended ? 'Replay video' : 'Play video'}
          className="orbit-vplayer-centerbtn"
        >
          {ended ? (
            <RotateCcw className="size-6" />
          ) : (
            <Play className="ml-0.5 size-6" fill="currentColor" strokeWidth={0} />
          )}
        </button>
      )}

      <div className="orbit-vplayer-hud" onClick={(e) => e.stopPropagation()}>
        {/* Custom Orbit scrubber */}
        <div
          ref={trackRef}
          role="slider"
          aria-label="Seek video"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(currentTime)}
          tabIndex={0}
          className="orbit-vplayer-scrub"
          onPointerDown={(e) => {
            e.preventDefault();
            setScrubbing(true);
            seekAtClientX(e.clientX);
          }}
          onMouseMove={(e) => {
            if (!duration) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
            setHoverTime({ pct: pct * 100, secs: pct * duration });
          }}
          onMouseLeave={() => setHoverTime(null)}
          onKeyDown={(e) => {
            const vid = videoRef.current;
            if (!vid) return;
            if (e.key === 'ArrowLeft') {
              e.preventDefault();
              e.stopPropagation();
              vid.currentTime = Math.max(0, vid.currentTime - 5);
            } else if (e.key === 'ArrowRight') {
              e.preventDefault();
              e.stopPropagation();
              vid.currentTime = Math.min(vid.duration || 0, vid.currentTime + 5);
            }
          }}
        >
          {hoverTime && (
            <span className="orbit-vplayer-tip" style={{ left: `${hoverTime.pct}%` }}>
              {fmtVideoClock(hoverTime.secs)}
            </span>
          )}
          <span className="orbit-vplayer-rail">
            <span className="orbit-vplayer-buf" style={{ width: `${bufferedPct}%` }} />
            <span className="orbit-vplayer-fill" style={{ width: `${progressPct}%` }} />
            <span className="orbit-vplayer-thumb" style={{ left: `${progressPct}%` }} />
          </span>
        </div>

        {/* Bottom controls row */}
        <div className="orbit-vplayer-row">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={togglePlay}
              className="orbit-vplayer-btn is-primary"
              aria-label={ended ? 'Replay' : playing ? 'Pause' : 'Play'}
              title={ended ? 'Replay (Space)' : playing ? 'Pause (Space)' : 'Play (Space)'}
            >
              {ended ? (
                <RotateCcw className="size-4" />
              ) : playing ? (
                <Pause className="size-4" fill="currentColor" strokeWidth={0} />
              ) : (
                <Play className="ml-0.5 size-4" fill="currentColor" strokeWidth={0} />
              )}
            </button>

            <div className="orbit-vplayer-vol">
              <button
                type="button"
                onClick={toggleMute}
                className="orbit-vplayer-btn"
                aria-label={muted ? 'Unmute' : 'Mute'}
                title={muted ? 'Unmute (M)' : 'Mute (M)'}
              >
                <VolumeIcon className="size-4" />
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={effectiveVolume}
                aria-label="Volume"
                onChange={(e) => changeVolume(Number(e.target.value))}
                className="orbit-vplayer-volslider"
              />
            </div>

            <span className="orbit-vplayer-clock orbit-num">
              <b>{fmtVideoClock(currentTime)}</b>
              <span>/</span>
              <span>{fmtVideoClock(duration)}</span>
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={cycleRate}
              className="orbit-vplayer-rate orbit-num"
              title="Playback speed"
              aria-label={`Playback speed ${rate}x`}
            >
              {rate}×
            </button>
            <button
              type="button"
              onClick={toggleFullscreen}
              className="orbit-vplayer-btn"
              title={isFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CaptureViewerModal({
  item,
  items,
  resolveGame,
  onSelect,
  onClose,
  onDelete,
}: {
  item: GalleryItem | null;
  items: GalleryItem[];
  resolveGame: (item: GalleryItem) => { game?: Game; title: string };
  onSelect: (item: GalleryItem) => void;
  onClose: () => void;
  onDelete?: (item: GalleryItem) => void;
}) {
  const viewerIndex = item ? items.findIndex((entry) => entry.path === item.path) : -1;

  // Lock body + .orbit-scroll and mark viewer active so parent Esc handlers never fire
  useEffect(() => {
    if (!item) return;
    const scroller = document.querySelector<HTMLElement>('.orbit-scroll');
    const prevBodyOverflow = document.body.style.overflow;
    const prevScrollerOverflow = scroller?.style.overflow ?? '';
    document.body.dataset.orbitViewerOpen = 'true';
    document.body.style.overflow = 'hidden';
    if (scroller) scroller.style.overflow = 'hidden';
    return () => {
      delete document.body.dataset.orbitViewerOpen;
      document.body.style.overflow = prevBodyOverflow;
      if (scroller) scroller.style.overflow = prevScrollerOverflow;
    };
  }, [item]);

  // Capture-phase keydown so Escape closes ONLY this viewer and never deselects the game in Observatory
  useEffect(() => {
    if (!item) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        onClose();
      } else if (event.key === 'ArrowLeft' && viewerIndex > 0) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        onSelect(items[viewerIndex - 1]);
      } else if (event.key === 'ArrowRight' && viewerIndex >= 0 && viewerIndex < items.length - 1) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        onSelect(items[viewerIndex + 1]);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [item, viewerIndex, items, onClose, onSelect]);

  if (!item) return null;

  const { game: viewerGame, title: viewerTitle } = resolveGame(item);
  const whenText = formatCaptureWhen(item);
  const sizeText = formatCaptureSize(item);

  return createPortal(
    <div
      className="orbit-viewer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={item.kind === 'screenshot' ? `Screenshot ${item.name}` : `Video ${item.name}`}
      onClick={onClose}
    >
      <div className="orbit-viewer-card" onClick={(event) => event.stopPropagation()}>
        <header className="orbit-viewer-head">
          <div className="flex min-w-0 items-center gap-3">
            <span className="orbit-viewer-cover">
              {viewerGame ? (
                <Cover game={viewerGame} className="size-full" fit="cover" />
              ) : (
                <span className="grid size-full place-items-center bg-panel2 text-[10px] font-bold text-muted">
                  {viewerTitle.slice(0, 2).toUpperCase()}
                </span>
              )}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="truncate text-[13.5px] font-bold text-fg">{viewerTitle}</h4>
                <span className="orbit-viewer-badge">
                  {item.kind === 'screenshot'
                    ? 'Screenshot'
                    : item.kind === 'recording'
                      ? 'Recording'
                      : 'Replay'}
                </span>
              </div>
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
                <span className="truncate max-w-[18rem]">{item.name}</span>
                {whenText && <span>· {whenText}</span>}
                {sizeText && <span>· {sizeText}</span>}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {items.length > 1 && viewerIndex >= 0 && (
              <div className="mr-1 flex items-center gap-1">
                <button
                  type="button"
                  disabled={viewerIndex <= 0}
                  onClick={() => viewerIndex > 0 && onSelect(items[viewerIndex - 1])}
                  className="orbit-viewer-iconbtn"
                  title="Previous capture (←)"
                  aria-label="Previous capture"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <span className="orbit-num px-1 text-[11px] font-medium text-muted">
                  {viewerIndex + 1} / {items.length}
                </span>
                <button
                  type="button"
                  disabled={viewerIndex >= items.length - 1}
                  onClick={() => viewerIndex < items.length - 1 && onSelect(items[viewerIndex + 1])}
                  className="orbit-viewer-iconbtn"
                  title="Next capture (→)"
                  aria-label="Next capture"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={() => void revealInExplorer(item.path)}
              className="orbit-btnquiet"
              title="Show in its folder"
            >
              <FolderOpen className="size-3.5" />
              <span className="hidden sm:inline">Show in folder</span>
            </button>
            {onDelete && (
              <button
                type="button"
                onClick={() => onDelete(item)}
                className="orbit-viewer-iconbtn is-danger"
                title="Delete capture"
                aria-label="Delete capture"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
            <button
              type="button"
              aria-label="Close"
              title="Close (Esc)"
              onClick={onClose}
              className="orbit-viewer-iconbtn"
            >
              <X className="size-4" />
            </button>
          </div>
        </header>

        <div className="orbit-viewer-stage">
          {item.kind === 'screenshot' ? (
            <img src={fileSrc(item.path)} alt={item.name} className="orbit-viewer-media" />
          ) : (
            <OrbitVideoPlayer key={item.path} src={fileSrc(item.path)} title={item.name} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

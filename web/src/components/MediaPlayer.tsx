import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { fileSrc } from '../services/desktop';
import { audioSet, audioSetNamed, mediaControl, mediaNow, type NowPlaying } from '../services/native';

function artSrc(art: string): string {
  if (!art) return '';
  if (art.startsWith('data:') || art.startsWith('http://') || art.startsWith('https://')) return art;
  const path = art.startsWith('file://') ? decodeURI(art.slice(7)) : art;
  return fileSrc(path);
}

/**
 * The thing playing in another app: a song, or a browser video.
 * The slider is that app's volume, the same one as the mixer.
 */
export function MediaPlayer({ pad = false }: { pad?: boolean }) {
  const [items, setItems] = useState<NowPlaying[]>([]);
  const [picked, setPicked] = useState('');
  const [error, setError] = useState('');
  const pending = useRef<{ id: string; volume: number; muted: boolean } | null>(null);
  const pendingNamed = useRef<{ name: string; volume: number; muted: boolean } | null>(null);
  const heldPlay = useRef<{ id: string; playing: boolean; until: number } | null>(null);

  const refresh = () => {
    void mediaNow()
      .then((next) => {
        const held = pending.current;
        const named = pendingNamed.current;
        const play = heldPlay.current;
        if (play && Date.now() > play.until) heldPlay.current = null;
        setItems(next.map((item) => {
          let copy = item;
          if (held && item.volumeId === held.id) copy = { ...copy, volume: held.volume, muted: held.muted };
          if (named && !item.volumeId && (item.app === named.name || item.title === named.name)) {
            copy = { ...copy, volume: named.volume, muted: named.muted };
          }
          if (play && item.id === play.id && Date.now() <= play.until) {
            if (item.playing === play.playing) heldPlay.current = null;
            else copy = { ...copy, playing: play.playing };
          }
          return copy;
        }));
        setError('');
        setPicked((current) => (next.some((item) => item.id === current) ? current : next.find((item) => item.playing)?.id || next[0]?.id || ''));
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  };

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => window.clearInterval(timer);
  }, []);

  const current = items.find((item) => item.id === picked) ?? items[0];

  const act = (action: 'toggle' | 'next' | 'previous') => {
    if (!current) return;
    if (action === 'toggle') {
      const playing = !current.playing;
      const id = current.id;
      heldPlay.current = { id, playing, until: Date.now() + 2500 };
      setItems((list) => list.map((item) => (item.id === id ? { ...item, playing } : item)));
      void mediaControl(id, action).catch((reason) => {
        if (heldPlay.current?.id === id) heldPlay.current = null;
        setItems((list) => list.map((item) => (item.id === id ? { ...item, playing: !playing } : item)));
        setError(reason instanceof Error ? reason.message : String(reason));
      });
      return;
    }
    void mediaControl(current.id, action).then(refresh).catch((reason) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  };

  const setVolume = (volume: number) => {
    if (!current) return;
    const next = Math.min(100, Math.max(0, Math.round(volume)));
    const id = current.id;
    setItems((list) => list.map((item) => (item.id === id ? { ...item, volume: next } : item)));
    const apply = current.volumeId
      ? audioSet(current.volumeId, next, current.muted)
      : audioSetNamed(current.app || current.title, next, current.muted);
    if (current.volumeId) pending.current = { id: current.volumeId, volume: next, muted: current.muted };
    else pendingNamed.current = { name: current.app || current.title, volume: next, muted: current.muted };
    void apply.catch((reason) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (pending.current?.volume === next) pending.current = null;
      if (pendingNamed.current?.volume === next) pendingNamed.current = null;
    });
  };

  if (!current) {
    return (
      <p className="text-xs leading-relaxed text-white/55">
        {error || 'Nothing is playing. A song or a browser video shows up here.'}
      </p>
    );
  }

  const cover = artSrc(current.art);

  return (
    <div className="space-y-3">
      {items.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              data-overlay={pad ? '' : undefined}
              onClick={() => setPicked(item.id)}
              className={`max-w-[8rem] truncate rounded-full border px-2 py-0.5 text-[10px] ${item.id === current.id ? 'border-white bg-white text-black' : 'border-white/20 text-white/70'}`}
            >
              {item.app || item.title}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-3">
        <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-white/10">
          {cover ? (
            <img src={cover} alt="" className="size-full object-cover" draggable={false} />
          ) : (
            <span className="text-lg font-medium text-white/70">{(current.title || current.app || '?').slice(0, 1)}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-white">{current.title}</p>
          <p className="truncate text-[11px] text-white/50">{[current.artist, current.app].filter(Boolean).join(' · ')}</p>
          <div className="mt-2 flex items-center gap-1.5">
            <Control label="Previous" onClick={() => act('previous')} pad={pad}>
              <SkipBack className="size-3.5" />
            </Control>
            <Control label={current.playing ? 'Pause' : 'Play'} onClick={() => act('toggle')} pad={pad}>
              {current.playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            </Control>
            <Control label="Next" onClick={() => act('next')} pad={pad}>
              <SkipForward className="size-3.5" />
            </Control>
          </div>
        </div>
      </div>
      <input
        tabIndex={-1}
        type="range"
        min={0}
        max={100}
        value={current.volume}
        aria-label={`${current.app || current.title || 'App'} volume`}
        onChange={(event) => setVolume(Number(event.target.value))}
        className="w-full accent-white"
      />
      {error && <p className="text-[11px] text-white/50">{error}</p>}
    </div>
  );
}

function Control({
  label,
  onClick,
  pad,
  children,
}: {
  label: string;
  onClick: () => void;
  pad: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-overlay={pad ? '' : undefined}
      aria-label={label}
      onClick={onClick}
      className="grid size-7 place-items-center rounded-full border border-white/20 text-white/80 hover:border-white/50"
    >
      {children}
    </button>
  );
}

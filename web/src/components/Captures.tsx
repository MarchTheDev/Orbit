import { useState } from 'react';
import { Image, Play, RotateCcw } from 'lucide-react';
import { fileSrc } from '../services/desktop';
import type { GalleryItem } from '../services/native';
import { cn } from '../utils/cn';

export const CAPTURE_KINDS = ['screenshot', 'recording', 'replay'] as const;
export type CaptureKind = (typeof CAPTURE_KINDS)[number];

export const CAPTURE_LABELS: Record<CaptureKind, { one: string; many: string }> = {
  screenshot: { one: 'Screenshot', many: 'Screenshots' },
  recording: { one: 'Recording', many: 'Recordings' },
  replay: { one: 'Replay', many: 'Replays' },
};

/** The capture folder a title is filed under, mirroring Rust's `safe_name`. */
export function captureFolderName(title: string): string {
  const kept = [...title].filter((ch) => /[\p{L}\p{N} _-]/u.test(ch)).join('');
  const collapsed = kept.split(/\s+/).filter(Boolean).join(' ');
  const trimmed = collapsed.replace(/^\.+|\.+$/g, '').trim();
  return [...(trimmed || 'Orbit')].slice(0, 60).join('');
}

export function isCaptureKind(kind: string): kind is CaptureKind {
  return (CAPTURE_KINDS as readonly string[]).includes(kind);
}

/** Everything filed under one game, newest first as Rust returns them. */
export function capturesOf(items: GalleryItem[], title: string): GalleryItem[] {
  const folder = captureFolderName(title);
  return items.filter((item) => item.game === folder && isCaptureKind(item.kind));
}

export function captureCounts(items: GalleryItem[]): Record<CaptureKind, number> {
  const counts: Record<CaptureKind, number> = { screenshot: 0, recording: 0, replay: 0 };
  for (const item of items) {
    if (isCaptureKind(item.kind)) counts[item.kind] += 1;
  }
  return counts;
}

/** A still for a screenshot, a first frame for a clip. */
export function CaptureThumb({ item, className }: { item: GalleryItem; className?: string }) {
  const src = fileSrc(item.path);
  const [failed, setFailed] = useState(false);
  if (failed || !src) {
    return (
      <span className={cn('grid h-full w-full place-items-center bg-black/25 text-muted', className)}>
        <Image className="size-4" />
      </span>
    );
  }
  if (item.kind === 'screenshot') {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        className={cn('h-full w-full object-cover', className)}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="relative block h-full w-full">
      <video
        src={`${src}#t=0.2`}
        muted
        preload="metadata"
        playsInline
        className={cn('h-full w-full object-cover', className)}
        onLoadedData={(event) => {
          const video = event.currentTarget;
          if (video.currentTime < 0.1) video.currentTime = 0.2;
        }}
        onError={() => setFailed(true)}
      />
      <span className="pointer-events-none absolute inset-0 grid place-items-center">
        <span className="grid size-8 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm">
          {item.kind === 'replay' ? <RotateCcw className="size-3.5" /> : <Play className="size-3.5" fill="currentColor" strokeWidth={0} />}
        </span>
      </span>
    </span>
  );
}

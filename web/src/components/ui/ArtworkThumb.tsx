import { useEffect, useRef, useState } from 'react';
import { fetchMetadata } from '../../services/metadata';
import { hashHue } from '../../utils/format';

/** A small, lazy cover for library-import lists; unresolved art stays harmless. */
export function ArtworkThumb({
  title,
  appId,
  lookup = false,
}: {
  title: string;
  appId?: number;
  /** Ask the catalogue for art only when this row is actually on screen. */
  lookup?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(!lookup || Boolean(appId));
  const [src, setSrc] = useState<string | null>(
    appId ? `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_600x900.jpg` : null,
  );
  const [failed, setFailed] = useState(false);
  const secondSteamArt = useRef(false);
  const metadataFallbackTried = useRef(false);

  useEffect(() => {
    secondSteamArt.current = false;
    metadataFallbackTried.current = false;
    setFailed(false);
    setSrc(appId ? `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_600x900.jpg` : null);
  }, [appId, title]);

  useEffect(() => {
    if (!lookup || appId || !host.current) return;
    const node = host.current;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '120px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [lookup, appId]);

  useEffect(() => {
    if (!visible || !lookup || appId || src) return;
    let alive = true;
    void fetchMetadata(title).then((meta) => {
      if (!alive) return;
      setSrc(meta.coverUrl || meta.headerUrl || null);
      if (!meta.coverUrl && !meta.headerUrl) setFailed(true);
    }).catch(() => {
      if (alive) setFailed(true);
    });
    return () => { alive = false; };
  }, [visible, lookup, appId, src, title]);

  const onError = () => {
    if (appId && !secondSteamArt.current) {
      secondSteamArt.current = true;
      setSrc(`https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`);
      return;
    }
    // Demos and tools often have no Steam library portrait. Search by the
    // display name once before falling back to initials; a demo can then use
    // its parent game's store art without changing the imported app id.
    if (lookup && !metadataFallbackTried.current) {
      metadataFallbackTried.current = true;
      void fetchMetadata(title).then((meta) => {
        const fallback = meta.coverUrl || meta.headerUrl || null;
        if (fallback) {
          setFailed(false);
          setSrc(fallback);
        } else {
          setFailed(true);
        }
      }).catch(() => setFailed(true));
      return;
    }
    setFailed(true);
  };
  const initials = title.trim().split(/\s+/).slice(0, 2).map((word) => word[0] ?? '').join('').toUpperCase() || '•';

  return (
    <div ref={host} className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg border border-line/70 bg-panel2 text-[10px] font-bold text-white/80">
      {src && !failed ? (
        <img src={src} alt={`${title} cover`} loading="lazy" onError={onError} className="size-full object-cover" />
      ) : (
        <span className="grid size-full place-items-center" style={{ backgroundColor: `hsl(${hashHue(title)} 40% 28%)` }} aria-hidden="true">
          {initials}
        </span>
      )}
    </div>
  );
}

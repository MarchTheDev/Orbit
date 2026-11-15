import { useEffect, useState } from 'react';
import { closeWindow, customTitleBar, minimizeWindow, toggleMaximizeWindow, watchMaximized } from '../services/windowChrome';

/**
 * The frame's three buttons, drawn by Orbit.
 *
 * They used to be CSS shapes: a 1 px bar for minimize, two borders glued
 * together for restore, two rotated lines for close. Each one was centred by a
 * different rule, so the trio never quite sat on the same line, and the restore
 * glyph's second square hung off its own box. Here every glyph is one 10 × 10
 * SVG with the same viewBox and the same stroke, so all three share one optical
 * centre and one weight; `vectorEffect` keeps the stroke exactly one pixel on
 * any display scale.
 *
 * The hit area is the part that matters for feel. Each button fills the whole
 * height of the bar and is 46 px wide - the size Windows gives them - and the
 * group is lifted above the drag region, so a press is a press and never the
 * start of a window drag. Close keeps the red hover everyone expects; the other
 * two only brighten.
 */
export function WindowControls() {
  /** Whether the window currently fills the screen, so the middle button knows which glyph to draw. */
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let stop = () => {};
    void watchMaximized(setMaximized).then((unlisten) => {
      stop = unlisten;
    });
    return () => stop();
  }, []);

  if (!customTitleBar) return null;

  return (
    <div className="orbit-wincontrols" role="group" aria-label="Window controls">
      <button type="button" onClick={() => void minimizeWindow()} title="Minimize" aria-label="Minimize">
        <Glyph kind="min" />
      </button>
      <button
        type="button"
        onClick={() => void toggleMaximizeWindow()}
        title={maximized ? 'Restore' : 'Maximize'}
        aria-label={maximized ? 'Restore' : 'Maximize'}
      >
        <Glyph kind={maximized ? 'restore' : 'max'} />
      </button>
      <button
        type="button"
        className="orbit-win-close"
        onClick={() => void closeWindow()}
        title="Close"
        aria-label="Close"
      >
        <Glyph kind="close" />
      </button>
    </div>
  );
}

/**
 * One window glyph.
 *
 * All four drawings live in the same 10 × 10 box and are stroked at 1 px with
 * square caps, so the bar, the box, the pair of boxes and the cross all read at
 * the same weight. The restore pair is built from one square and its copy
 * shifted by exactly the stroke width, which is what makes it look symmetrical
 * instead of like a square with a flap on one corner.
 */
function Glyph({ kind }: { kind: 'min' | 'max' | 'restore' | 'close' }) {
  return (
    <svg
      className="orbit-win-glyph"
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      aria-hidden
      focusable="false"
      shapeRendering="crispEdges"
    >
      {kind === 'min' && <path d="M0 5.5h10" strokeLinecap="butt" />}
      {kind === 'max' && <rect x="0.5" y="0.5" width="9" height="9" />}
      {kind === 'restore' && (
        <>
          {/* The square behind, then the one in front cut out of it so the
              two never draw over each other as a solid block. */}
          <path d="M2.5 2.5V0.5h7v7h-2.5" />
          <rect x="0.5" y="2.5" width="7" height="7" />
        </>
      )}
      {kind === 'close' && <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" strokeLinecap="butt" />}
    </svg>
  );
}

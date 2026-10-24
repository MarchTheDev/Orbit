import { useEffect, useRef, useState } from 'react';
import { Keyboard, RotateCcw } from 'lucide-react';
import type { OverlayShortcuts, PadChord } from '../types';
import {
  CAPTURE_ACTIONS,
  DEFAULT_SHORTCUTS,
  PAD_BUTTONS,
  keyLabel,
  normalizeShortcuts,
  padChordLabel,
  shortcutFromEvent,
} from '../utils/shortcuts';
import { cn } from '../utils/cn';
import { overlayRefusedShortcuts } from '../services/native';
import { Select } from './ui/Select';
import { btnBrowse } from './ui/Modal';

/**
 * The capture shortcuts, the way a game offers them.
 *
 * Two answers for the same three actions: what to press on a controller, and
 * what to press on a keyboard. They are shown side by side because they are the
 * same three things - a player looking for "how do I take a screenshot" wants
 * both, not two pages.
 *
 * The controller side is chosen from the pad's own buttons rather than by
 * pressing one, because the page cannot read a controller on every desktop
 * Orbit runs on: on Linux the pad is read by the desktop side, and asking the
 * web view for it there is what used to freeze the window. Choosing from a list
 * works everywhere, including with no controller plugged in.
 *
 * The keyboard side is recorded: press it and it becomes the shortcut, which is
 * the only way to be sure it is a combination the system will actually deliver.
 */
export function ShortcutEditor({
  value,
  onChange,
}: {
  value: OverlayShortcuts | undefined;
  onChange: (next: OverlayShortcuts) => void;
}) {
  const shortcuts = normalizeShortcuts(value);
  /** The action whose controller chord is open for choosing. */
  const [open, setOpen] = useState<string | null>(null);
  /** The action whose keyboard shortcut is being recorded. */
  const [listening, setListening] = useState<string | null>(null);
  /**
   * The combinations the system would not give Orbit.
   *
   * Registration happens on the desktop side when the settings are written, so
   * the answer is asked for again a moment after a change - asking straight
   * away would read the answer to the last one.
   */
  const [refused, setRefused] = useState<string[]>([]);
  useEffect(() => {
    const check = () => void overlayRefusedShortcuts().then(setRefused).catch(() => undefined);
    const timer = window.setTimeout(check, 400);
    return () => window.clearTimeout(timer);
  }, [value]);

  const setChord = (action: keyof OverlayShortcuts['pad'], next: PadChord) =>
    onChange({ ...shortcuts, pad: { ...shortcuts.pad, [action]: next } });
  const setKey = (action: keyof OverlayShortcuts['keys'], next: string) =>
    onChange({ ...shortcuts, keys: { ...shortcuts.keys, [action]: next } });

  // The recorded combination. On the window rather than the button, because the
  // focus is wherever the player left it and the press is the thing being read.
  const listeningRef = useRef(listening);
  listeningRef.current = listening;
  useEffect(() => {
    if (!listening) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setListening(null);
        return;
      }
      // Backspace clears rather than binding a key that deletes: a shortcut
      // that cannot be pressed on its own is not a shortcut.
      if (event.key === 'Backspace' && !event.ctrlKey && !event.altKey && !event.metaKey) {
        setKey(listeningRef.current as keyof OverlayShortcuts['keys'], '');
        setListening(null);
        return;
      }
      const combo = shortcutFromEvent(event);
      if (!combo) return;
      setKey(listeningRef.current as keyof OverlayShortcuts['keys'], combo);
      setListening(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [listening]);

  const reset = () => onChange(normalizeShortcuts(DEFAULT_SHORTCUTS));

  return (
    <div className="space-y-2 rounded-2xl border border-line bg-panel2/30 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Capture shortcuts</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            For a screenshot, a recording, and a replay while a game is in front. The controller
            side is read by Orbit itself; the keyboard side is registered with the system, so it
            works over the game.
          </p>
        </div>
        <button type="button" onClick={reset} className={btnBrowse}>
          <RotateCcw className="mr-1.5 inline size-3.5" />
          Reset all
        </button>
      </div>

      <div className="space-y-1.5">
        <div className="hidden grid-cols-[1fr_10rem_10rem] gap-2 px-1 text-[10px] font-bold uppercase tracking-[0.16em] text-muted sm:grid">
          <span>Action</span>
          <span>Controller</span>
          <span>Keyboard</span>
        </div>

        {CAPTURE_ACTIONS.map((action) => {
          const chord = shortcuts.pad[action.id];
          const chosen = open === action.id;
          return (
            <div
              key={action.id}
              className="rounded-xl border border-line bg-panel/40 px-3 py-2"
            >
              <div className="grid gap-2 sm:grid-cols-[1fr_10rem_10rem] sm:items-center">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-fg">{action.label}</p>
                  <p className="text-[11px] leading-snug text-muted">{action.hint}</p>
                </div>

                <button
                  type="button"
                  onClick={() => setOpen(chosen ? null : action.id)}
                  aria-expanded={chosen}
                  aria-label={`${action.label} controller shortcut: ${padChordLabel(chord)}`}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition',
                    chosen
                      ? 'border-accent bg-accent/15 text-fg'
                      : 'border-line bg-panel2 text-muted hover:border-accent hover:text-fg',
                  )}
                >
                  <span className="truncate font-mono">{padChordLabel(chord)}</span>
                  <span aria-hidden className="text-[10px] uppercase tracking-wider opacity-60">
                    pad
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setListening(listening === action.id ? null : action.id)}
                  aria-label={`${action.label} keyboard shortcut: ${keyLabel(shortcuts.keys[action.id])}`}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition',
                    listening === action.id
                      ? 'border-accent bg-accent/15 text-fg'
                      : 'border-line bg-panel2 text-muted hover:border-accent hover:text-fg',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Keyboard className="size-3.5 shrink-0 opacity-70" />
                    <span className="truncate font-mono">
                      {listening === action.id ? 'Press a key…' : keyLabel(shortcuts.keys[action.id])}
                    </span>
                  </span>
                  {listening === action.id && (
                    <span aria-hidden className="text-[10px] uppercase tracking-wider opacity-60">
                      esc
                    </span>
                  )}
                </button>
              </div>

              {chosen && (
                <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-line bg-panel2/60 p-2">
                  <span className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-[0.14em] text-muted">Hold</span>
                    <Select
                      value={chord.hold === null ? 'none' : String(chord.hold)}
                      onChange={(next) =>
                        setChord(action.id, {
                          hold: next === 'none' ? null : Number(next),
                          button: chord.button,
                        })
                      }
                      options={[
                        { value: 'none', label: 'Nothing' },
                        ...PAD_BUTTONS.filter((button) => button.index !== chord.button).map(
                          (button) => ({ value: String(button.index), label: button.label }),
                        ),
                      ]}
                      className="w-40"
                      ariaLabel={`${action.label}: the button held first`}
                    />
                  </span>
                  <span className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-[0.14em] text-muted">
                      Then press
                    </span>
                    <Select
                      value={String(chord.button)}
                      onChange={(next) =>
                        setChord(action.id, { hold: chord.hold, button: Number(next) })
                      }
                      options={PAD_BUTTONS.filter((button) => button.index !== chord.hold).map(
                        (button) => ({ value: String(button.index), label: button.label }),
                      )}
                      className="w-40"
                      ariaLabel={`${action.label}: the button that completes it`}
                    />
                  </span>
                  <button type="button" onClick={() => setOpen(null)} className={btnBrowse}>
                    Done
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {refused.length > 0 && (
        <p className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-[11px] leading-relaxed text-amber-300">
          {refused.join(' ')} Orbit could not take it, so that shortcut will not work until it is
          changed or the other program is closed.
        </p>
      )}

      <p className="text-[11px] leading-relaxed text-muted">
        The overlay itself is always Alt+X, or Start and Select together. Backspace while recording
        a key clears it, and Escape leaves it as it was.
      </p>
    </div>
  );
}

/**
 * A short message in the corner, from anywhere.
 *
 * The library owns the list of toasts and draws them, but the thing worth saying
 * often happens several components down, and threading a callback through every
 * layer to say "saved" would be worse than a one-line channel. Nothing here is
 * state: it is a sentence on its way to the corner of the window.
 */
export type ToastTone = 'ok' | 'error';

type Listener = (text: string, tone: ToastTone) => void;

let listener: Listener | null = null;

/** Called by whoever draws the toasts. */
export function onToast(fn: Listener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

/** Say something, from anywhere in the app. */
export function say(text: string, tone: ToastTone = 'ok'): void {
  listener?.(text, tone);
}

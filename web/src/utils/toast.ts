/**
 * A short message in the corner, from anywhere.
 *
 * The library owns the list of toasts and draws them, but the thing worth saying
 * often happens several components down, and threading a callback through every
 * layer to say "saved" would be worse than a one-line channel. Nothing here is
 * state: it is a sentence on its way to the corner of the window.
 */
export type ToastTone = 'ok' | 'error';

/** A button along the bottom of a toast. */
export interface ToastAction {
  label: string;
  onSelect: () => void;
}

export interface ToastMessage {
  text: string;
  tone?: ToastTone;
  /**
   * Buttons, for a toast that is asking something rather than telling. Choosing
   * one closes the toast, so "Later" is an action that does nothing.
   */
  actions?: ToastAction[];
  /**
   * Stay until it is dealt with. A note about something that just happened can
   * fade on its own; a question cannot.
   */
  sticky?: boolean;
}

type Listener = (message: ToastMessage) => void;

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
  listener?.({ text, tone });
}

/**
 * Say something that needs an answer: a message with buttons under it and no
 * timer, because a question that disappears while it is being read is worse
 * than no question at all.
 */
export function announce(message: ToastMessage): void {
  listener?.({ tone: 'ok', ...message });
}

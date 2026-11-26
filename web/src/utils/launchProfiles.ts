import type { Companion, Game, LaunchTarget } from '../types';

/**
 * Launch profiles, kept honest.
 *
 * A companion entry is one of two things, and the difference is not cosmetic:
 *
 * - `alongside` rides with every launch. It is a tool or a web page, never a
 *   way to start the game on its own.
 * - `alternative` is another way to start the same game. It is named, offered
 *   from the Play arrow, and when chosen it replaces the default launch rather
 *   than running beside it.
 *
 * The helpers here are the single place the UI and the editor agree on what a
 * valid entry is, so a half-typed row is never saved as a launch option that
 * silently does nothing.
 */

export interface LaunchDraft {
  launch: LaunchTarget;
  companions: Companion[];
}

export const isAlternative = (companion: Companion): boolean => companion.when === 'alternative';

export const draftFromGame = (game: Game): LaunchDraft => ({
  launch: game.launch ?? { kind: 'none' },
  companions: (game.companions ?? []).map((companion) => ({ ...companion })),
});

const trimmed = (value: string | null | undefined): string => (value ?? '').trim();

/** A profile needs a name and at least one thing that makes it different. */
export function alternativeIsValid(companion: Companion): boolean {
  if (!isAlternative(companion)) return true;
  if (!trimmed(companion.name)) return false;
  return Boolean(
    trimmed(companion.path) ||
      trimmed(companion.extraArgs) ||
      trimmed(companion.workingDir) ||
      (companion.starts ?? []).some((entry) => trimmed(entry)),
  );
}

/** An alongside entry needs a program or a page; an empty row is not a tool. */
export function alongsideIsValid(companion: Companion): boolean {
  if (isAlternative(companion)) return true;
  return Boolean(trimmed(companion.path) || trimmed(companion.url));
}

export function normalizeCompanion(companion: Companion): Companion {
  const next: Companion = {
    ...companion,
    path: trimmed(companion.path),
    args: trimmed(companion.args),
    url: companion.url === undefined ? undefined : trimmed(companion.url) || null,
    name: trimmed(companion.name) || undefined,
    extraArgs: trimmed(companion.extraArgs) || undefined,
    workingDir: trimmed(companion.workingDir) || null,
    starts: (companion.starts ?? []).map(trimmed).filter(Boolean),
  };
  if (isAlternative(next)) {
    // A profile is not a tool: it never carries an alongside URL of its own.
    next.url = null;
  }
  return next;
}

export interface LaunchProblem {
  index: number | null;
  message: string;
}

/** Everything wrong with a draft, in the order the editor should say it. */
export function launchProblems(draft: LaunchDraft): LaunchProblem[] {
  const problems: LaunchProblem[] = [];
  const target = draft.launch;
  if ((target.kind === 'executable' || target.kind === 'wine') && !trimmed(target.path)) {
    problems.push({ index: null, message: 'Choose the program Orbit should start, or switch to Timer only.' });
  }
  if (target.kind === 'steam' && (!Number.isFinite(target.appId) || target.appId <= 0)) {
    problems.push({ index: null, message: 'A Steam launch needs the game’s app id.' });
  }
  draft.companions.forEach((companion, index) => {
    if (isAlternative(companion)) {
      if (!trimmed(companion.name)) {
        problems.push({ index, message: 'Name this launch option so it can be picked from Play.' });
      } else if (!alternativeIsValid(companion)) {
        problems.push({ index, message: `“${trimmed(companion.name)}” needs a program, extra arguments, a working folder, or something to start first.` });
      }
      if ((target.kind === 'steam' || target.kind === 'lutris') && trimmed(companion.path)) {
        problems.push({ index, message: 'A launcher-managed game keeps its own program. Use extra arguments or helper programs instead.' });
      }
    } else if (!alongsideIsValid(companion)) {
      problems.push({ index, message: 'Choose a program or enter a web address for this companion.' });
    }
    if (!isAlternative(companion) && trimmed(companion.url)) {
      try {
        const url = new URL(trimmed(companion.url));
        if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('bad protocol');
      } catch {
        problems.push({ index, message: 'A companion web page needs a full http:// or https:// address.' });
      }
    }
  });
  return problems;
}

export function normalizeDraft(draft: LaunchDraft): LaunchDraft {
  return {
    launch: draft.launch,
    companions: draft.companions.map(normalizeCompanion),
  };
}

/** The label the Play arrow shows for a saved profile. */
export function alternativeLabel(companion: Companion, index: number): string {
  return trimmed(companion.name) || `Launch option ${index + 1}`;
}

/** Only profiles that can actually be offered from Play. */
export function usableAlternatives(companions: Companion[]): { companion: Companion; index: number }[] {
  return companions
    .map((companion, index) => ({ companion, index }))
    .filter(({ companion }) => isAlternative(companion) && alternativeIsValid(companion));
}

export function launchKindLabel(target: LaunchTarget): string {
  switch (target.kind) {
    case 'executable':
      return 'Program';
    case 'wine':
      return 'Windows program';
    case 'steam':
      return 'Steam';
    case 'lutris':
      return 'Lutris';
    default:
      return 'Timer only';
  }
}

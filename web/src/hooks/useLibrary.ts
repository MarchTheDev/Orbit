import { useCallback, useEffect, useRef, useState } from 'react';
import type { Game, MetaData, Settings } from '../types';

import { deleteGame as removeFromDb, listGames, saveGame, clearLibrary } from '../services/native';
import { loadSettings, saveSettings } from '../services/storage';
import { DEFAULT_SETTINGS } from '../data/sampleGames';
import { applyFont, applyTheme } from '../data/themes';

/**
 * Fields a person fills in, as opposed to anything Orbit works out.
 *
 * A patch touching one of these marks the game as corrected by hand, which is
 * what stops the background lookups from overwriting it later.
 */
const PLAYER_FIELDS: (keyof Game)[] = ['meta', 'title', 'coverPath', 'hltb', 'notes'];

/** The shape `MetaData` always has, for a game that has no details yet. */
function baseMeta(meta: MetaData | undefined): MetaData {
  return {
    summary: '',
    genres: [],
    developer: '',
    releaseYear: null,
    rating: null,
    ...meta,
  };
}

/**
 * The library, kept in step with the database.
 *
 * Every change is written straight through, so there is no save button and no
 * way for the file to fall behind what is on screen.
 */
export function useLibrary() {
  const [games, setGames] = useState<Game[]>([]);
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [ready, setReady] = useState(false);
  /** The write queue, so two quick edits cannot race each other. */
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  /**
   * The games as they are right now.
   *
   * Changes are worked out from this rather than inside `setGames`, because a
   * state updater must stay free of side effects: React may run it twice, and a
   * write to the database should happen once.
   */
  const gamesRef = useRef<Game[]>([]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [loaded, savedSettings] = await Promise.all([listGames(), loadSettings()]);
      if (!alive) return;
      const loadedSettings = savedSettings.theme === 'aurora'
        ? { ...savedSettings, theme: 'rubellite' }
        : savedSettings;
      if (loadedSettings !== savedSettings) void saveSettings(loadedSettings);
      gamesRef.current = loaded;
      setGames(loaded);
      setSettingsState(loadedSettings);
      applyTheme(loadedSettings.theme);
      applyFont(loadedSettings.fontFamily ?? 'system');
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const reload = useCallback(async () => {
    const loaded = await listGames();
    gamesRef.current = loaded;
    setGames(loaded);
  }, []);

  const save = useCallback((game: Game) => {
    // Serialised, so the last write for a game always wins.
    queue.current = queue.current.then(() => saveGame(game)).catch(console.error);
  }, []);

  /**
   * Change a game.
   *
   * `origin` says who is asking: a person, or one of the background lookups.
   * A lookup never overrules a correction somebody made by hand, which is what
   * keeps an edited title, cover or set of times from being quietly replaced
   * minutes later by a search that used the old file name.
   */
  const updateGame = useCallback(
    (id: string, patch: Partial<Game> | ((g: Game) => Partial<Game>), origin: 'player' | 'auto' = 'player') => {
      const current = gamesRef.current;
      const target = current.find((g) => g.id === id);
      if (!target) return;
      if (origin === 'auto' && target.meta?.edited) return;
      const next = typeof patch === 'function' ? patch(target) : patch;
      const updated = { ...target, ...next };
      // Pointing Orbit at a program is what turns a plan into a game: it stops
      // being something written down and becomes something it can start.
      const launchTarget = next.launch as { kind?: string } | undefined;
      const pointsAtAProgram =
        Boolean(next.exePath) ||
        Boolean(next.installDir) ||
        launchTarget?.kind === 'executable' ||
        launchTarget?.kind === 'steam';
      if (pointsAtAProgram) updated.planned = false;
      // Anything typed in by hand is remembered with the game, so the record
      // survives a restart and the lookups know to keep their hands off it.
      if (origin === 'player' && PLAYER_FIELDS.some((key) => key in next)) {
        updated.meta = { ...baseMeta(updated.meta), ...updated.meta, edited: true };
      }
      gamesRef.current = current.map((g) => (g.id === id ? updated : g));
      setGames(gamesRef.current);
      save(updated);
    },
    [save],
  );

  const addGame = useCallback(
    (game: Game) => {
      save(game);
      gamesRef.current = [...gamesRef.current, game];
      setGames(gamesRef.current);
    },
    [save],
  );

  const addGames = useCallback(
    (incoming: Game[]) => {
      if (incoming.length === 0) return;
      for (const game of incoming) save(game);
      gamesRef.current = [...gamesRef.current, ...incoming];
      setGames(gamesRef.current);
    },
    [save],
  );

  const removeGame = useCallback((id: string) => {
    queue.current = queue.current.then(() => removeFromDb(id)).catch(console.error);
    gamesRef.current = gamesRef.current.filter((g) => g.id !== id);
    setGames(gamesRef.current);
  }, []);

  const setSettings = useCallback((patch: Partial<Settings>) => {
    setSettingsState((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      if (patch.theme) applyTheme(patch.theme);
      if (patch.fontFamily) applyFont(patch.fontFamily);
      queue.current = queue.current.then(() => saveSettings(next)).catch(console.error);
      return next;
    });
  }, []);

  /**
   * Put the whole install back to how it looked on first run.
   *
   * The work joins the same queue as every other write, so a setting saved a
   * moment earlier is never overtaken by the reset, and the reload waits until
   * the database has actually been written.
   */
  /**
   * Wait for every change made so far to reach the database.
   *
   * Writes are queued so the last one for a game wins, which means the state on
   * screen is briefly ahead of the state on disk. Starting a session reads the
   * launch target from disk, so a launch right after changing that target has to
   * wait for the change to land: otherwise "Timer only", pressed and followed by
   * Play, still starts the game the old setting pointed at.
   */
  const flush = useCallback(() => queue.current, []);

  const resetEverything = useCallback(() => {
    queue.current = queue.current
      .then(() => clearLibrary())
      .then(() => saveSettings(DEFAULT_SETTINGS))
      .then(() => {
        applyTheme(DEFAULT_SETTINGS.theme);
        applyFont(DEFAULT_SETTINGS.fontFamily ?? 'system');
        location.reload();
      })
      .catch(console.error);
  }, []);

  return { games, settings, setSettings, updateGame, addGame, addGames, removeGame, reload, flush, resetEverything, ready };
}

export type Library = ReturnType<typeof useLibrary>;
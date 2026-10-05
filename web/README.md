# Orbit

A library for the games on your PC: it launches them, keeps track of how long
you actually played, and shows where the disk space went.

Orbit is a desktop app. React and Tailwind for the interface, Rust behind it for
everything that touches the machine.

## Running it

```sh
npm install          # once
npm run tauri dev    # the real app, with launching, files and sessions
npm run tauri build  # installers in src-tauri/target/release/bundle
```

`npm run dev` alone opens a browser preview. That is useful for working on the
interface, but it cannot see your files, start a game or write a session — those
need the desktop shell.

## What it does

**Library** — every game, grouped and filtered, with cover art taken from the
folder it is in. Press Play and Orbit starts it and opens a session. Close the
game and the session closes with it, so the clock cannot run forever.

**Sessions** — every play session, newest first, with its length and what you
were doing. Add a session by hand for time played on a console or handheld, or
correct one that went wrong.

**Storage** — how much room each library folder takes and how much is left on
that drive. Games are only ever moved between folders you list here; anything
found elsewhere is tracked but never touched.

## How a game can be started

| Kind | What Orbit does |
| --- | --- |
| Timer only | Runs the clock. You start the game yourself. |
| Program | Runs the `.exe`, with optional arguments and working folder. |
| Steam | Asks Steam to run an app id. |
| Emulator | Runs a ROM through an emulator, with `{rom}` in the argument line. |

## Where things are kept

In `%APPDATA%\com.orbit.launcher`:

- `orbit.db` — the library and every session, in SQLite
- `settings.json` — theme, IGDB credentials, library folders

Both are plain files you can back up or delete. Deleting `orbit.db` empties the
library; nothing else on the machine is touched.

## Artwork and details

Cover art already sitting next to a game is used first, then artwork from IGDB,
then a generated placeholder. To fetch details from IGDB, create an app at
[dev.twitch.tv](https://dev.twitch.tv) and put the Client ID and App Access
Token in Settings. Both stay on your machine.

Completion estimates come from HowLongToBeat, which has no official API, so that
one can be slow or unavailable at times.

## Layout

```
src/                     the interface
  components/            screens and pieces of them
  hooks/                 useLibrary (data), useSession (the running game)
  services/native.ts     every call into Rust, with browser fallbacks
  services/desktop.ts    the file pickers and drag and drop
src-tauri/src/
  db.rs                  the library and sessions in SQLite
  session.rs             the session that is running, and the process it watches
  launch_target.rs       the four ways a game can be started
  storage.rs             drives, folder sizes, safe moves
  store.rs               settings.json
```

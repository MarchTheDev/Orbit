# Orbit

A library for the games on your PC: it launches them, keeps track of how long
you actually played, and shows where the disk space went.

Orbit is a desktop app. React and Tailwind for the interface, Rust behind it for
everything that touches the machine.

## Running it

```sh
cd web
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

**Backlog** — what is waiting, what is part-way through and what has been set
aside, with the waiting list ordered by how long a game takes to beat. A status
can be changed from the card without opening anything.

**Sessions** — every play session, newest first, with its length and what you
were doing. Add a session by hand for time played on a console or handheld, or
correct one that went wrong: both the moment it started and how long it ran are
editable, and the game's total follows.

**Log** — each game has its own log, which is the player's record rather than
Orbit's: `10h · 08-12-26 · finished main story`, typed in by hand, with the date
and the length chosen, and editable afterwards. Nothing there is tracked
automatically.

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

Dropping a program — or a folder holding one — anywhere on the window adds it
straight away. Only a drop Orbit cannot make a game out of opens the Add dialog,
which is the case that needs a decision rather than a keystroke.

## Artwork and details

Nothing to set up. Details come from the Steam catalogue, which needs no key:
summary, genres, developer, release year, artwork, and the store's own app id,
which Orbit offers as a one-click way to launch the game through Steam.
Completion estimates come from HowLongToBeat, which has no official API, so that
one can be slow or unavailable at times; the lookup handles the site's session
handshake and follows its endpoint when it is renamed.

Adding a Twitch application in Settings (Client ID + Client Secret) switches
lookups to IGDB for richer descriptions and ratings. Orbit mints the access
token itself and renews it before it expires, so there is no token to paste and
nothing to do when it lapses. A hand-pasted token from an older version still
works.

Games already in the library, or ones added while offline, are filled in quietly
in the background — a few at a time, because HowLongToBeat rate-limits a burst.

## Where things are kept

In `%APPDATA%\com.orbit.launcher`:

- `orbit.db` — the library, every session and every log note, in SQLite
- `settings.json` — theme, library folders, optional IGDB credentials

Both are plain files you can back up or delete. Deleting `orbit.db` empties the
library; nothing else on the machine is touched.

## Layout

```
web/
  src/                     the interface
    components/            screens and pieces of them
    hooks/                 useLibrary (data), useSession (the running game)
    services/metadata.ts   the store lookup, and IGDB when it is set up
    services/native.ts     every call into Rust, with browser fallbacks
    services/desktop.ts    the file pickers and drag and drop
  src-tauri/src/
    db.rs                  the library, sessions and notes in SQLite
    session.rs             the session that is running, and the process it watches
    launch_target.rs       the four ways a game can be started
    metadata.rs            the store lookup, and IGDB's token
    hltb.rs                HowLongToBeat, handshake and all
    storage.rs             drives, folder sizes, safe moves
    store.rs               settings.json
```

# Orbit

A library for the games on your PC: it launches them, keeps track of how long
you actually played, and shows where the disk space went.

Orbit is a desktop app. React and Tailwind for the interface, in `web/`; Rust
behind it for everything that touches the machine, in `web/src-tauri/`.

## Running it

From the repository root — `npm install` here knows to install the app's own
dependencies too:

```sh
npm install          # once
npm run tauri dev    # the real app, with launching, files and sessions
npm run tauri build  # installers in web/src-tauri/target/release/bundle
```

`npm run dev` alone opens a browser preview of the interface. That is useful for
working on the design, but it cannot see your files, start a game or write a
session — those need the desktop shell.

Running the app needs the [Rust toolchain](https://rustup.rs) and, on Windows,
the WebView2 runtime that ships with Windows 11 and recent 10.

## What it does

**Library** — every game, grouped and filtered, with cover art taken from the
folder it is in or from the store. Press Play and Orbit starts it and opens a
session. Close the game and the session closes with it, so the clock cannot run
forever.

**Sessions** — every play session, newest first, with its length and what you
were doing. Add a session by hand for time played on a console or handheld, or
correct one that went wrong: both the moment it started and how long it ran are
editable, and the game's total follows.

**Backlog** — what is waiting, what is part-way through and what has been set
aside, with the waiting list ordered by how long a game takes to beat.

**Logs** — every game's log in one place: pick a game on the left, read and
write its notes on the right. A log is the player's own record, not the
tracker's: `10h · 08-12-26 · finished main story`, typed in by hand with the date
and the length chosen, and editable afterwards. The one thing Orbit writes
itself is the "Started playing" note, once, the first time a game is launched.

**Storage** — the games in your library grouped by drive, with a Move button on
each one, and how much room every library folder takes. Games are only ever
moved between folders you list here.

## Starting a game, and what comes with it

| Kind | What Orbit does |
| --- | --- |
| Timer only | Runs the clock. You start the game yourself. |
| Program | Runs the `.exe`, with optional arguments and working folder. |
| Through Steam | Only on games imported from a Steam library, which have to go through Steam to start. |

A game can also list programs to start **alongside** it — a frame-rate tool, a
mod controller — such as Lossless Scaling next to Assetto Corsa. Those are
started with the game and never watched, so closing one cannot end the session.

Dropping a program — or a folder holding one — anywhere on the window adds it
straight away. Only a drop Orbit cannot make a game out of opens the Add dialog,
which is the case that needs a decision rather than a keystroke.

## Steam

Games already installed through Steam can be brought over from **Steam library**
in the library toolbar, or from Settings. The dialog reads the Steam installs on
this PC and lists what is there; nothing is imported until a game is ticked, and
nothing runs on startup. A game that is in your Steam account but not installed
can be added by pasting its store link or app id. Either way, Orbit starts it
through Steam and shows an "Open in Steam" button on its page.

## Artwork and details

Nothing to set up. Details come from the Steam catalogue, which needs no key:
summary, genres, developer, release year and artwork — the portrait capsule the
client itself uses, with the wide header as a fallback that is fitted rather than
cropped. Completion estimates come from HowLongToBeat, which has no official API,
so that one can be slow or unavailable at times; the lookup handles the site's
session handshake and follows its endpoint when it is renamed.

There is no second provider and no API key to paste. Games added while offline,
or ones that arrived before, are filled in quietly in the background — a few at a
time, because HowLongToBeat rate-limits a burst.

## Where things are kept

In `%APPDATA%\com.orbit.launcher`:

- `orbit.db` — the library, every session and every log note, in SQLite
- `settings.json` — theme, library folders, and whether to look games up

Both are plain files you can back up or delete. Deleting `orbit.db` empties the
library; nothing else on the machine is touched.

## Layout

```
web/
  src/                     the interface
    components/            screens and pieces of them
    hooks/                 useLibrary (data), useSession (the running game)
    services/metadata.ts   the store lookup
    services/native.ts     every call into Rust, with browser fallbacks
    services/desktop.ts    the file pickers, links and drag and drop
  src-tauri/src/
    db.rs                  the library, sessions and notes in SQLite
    session.rs             the session that is running, and what goes with it
    launch_target.rs       how a game is started
    metadata.rs            the Steam store, with no key at all
    steam.rs               reading the Steam library on this machine
    hltb.rs                HowLongToBeat, handshake and all
    storage.rs             drives, folder sizes, safe moves
    store.rs               settings.json
```

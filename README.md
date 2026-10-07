<div align="center">

<img src="web/src-tauri/icons/icon.png" alt="The Orbit mark" width="128" />

# Orbit

**A library for the games on your PC.**

It launches them, keeps track of how long you actually played, and shows where
the disk space went.

<!--
  The screenshot goes here. Save it as docs/screenshot.png and uncomment the
  line below.

  <img src="docs/screenshot.png" alt="Orbit's library" width="880" />
-->

[Download the latest release](https://github.com/MarchTheDev/Orbit/releases/latest)

</div>

## What it does

**Library** - every game, grouped and filtered, with cover art from the folder
it is in or from the store. Press Play and Orbit starts it and opens a session.
Close the game and the session closes with it, so the clock cannot run forever.

**Sessions** - every play session, newest first, with its length and what you
were doing. Add one by hand for time played on a console or handheld, or correct
one that went wrong.

**Backlog** - what is waiting, what is part-way through, and what has been set
aside, ordered by how long a game takes to beat.

**Logs** - your own record for every game: `10h · 08-12-26 · finished main
story`, written by hand and editable afterwards.

**Storage** - the games grouped by drive, with how much room every library
folder takes and a Move button that keeps the library pointing at the game.

**Music** - a slow pad Orbit makes itself, so nothing is downloaded and nothing
is licensed.

Settings covers the rest: the theme, cover size, how notes and dates are shown,
Steam and other launchers, sound, and updates.

## Starting a game

| Kind | What Orbit does |
| --- | --- |
| Timer only | Runs the clock. You start the game yourself. |
| Program | Runs the `.exe`, with optional arguments and working folder. |

A game can also list programs to start **alongside** it - a frame-rate tool, a
mod controller. Those start with the game and are never watched, so closing one
cannot end the session.

Dropping a program, or a folder holding one, anywhere on the window adds it
straight away.

## Details and artwork

Nothing to set up and no API key to paste. Summary, genres, developer, release
year and artwork come from the Steam catalogue; completion estimates come from
HowLongToBeat. Games added offline are filled in quietly in the background.

Games already installed through Steam can be brought over from **Steam library**
in the library toolbar, or from Settings. Nothing is imported until a game is
ticked, and nothing runs on startup.

## Install

Grab the file for your system from the
[latest release](https://github.com/MarchTheDev/Orbit/releases/latest).

| System | File |
| --- | --- |
| Windows | `Orbit-<version>-windows-setup.exe` |
| Linux (any distribution) | `Orbit-<version>-linux-x86_64.AppImage` |
| Debian, Ubuntu, Mint | `orbit_<version>_amd64.deb` |
| Fedora, openSUSE | `orbit-<version>-1.x86_64.rpm` |
| Arch | `orbit-<version>-1-x86_64.pkg.tar.zst`, with `pacman -U` |

## Where things are kept

In `%APPDATA%\com.orbit.launcher`:

- `orbit.db` - the library, every session and every log note, in SQLite
- `settings.json` - theme, library folders, and whether to look games up

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

## License

Orbit is free software under the **GNU General Public License v3**, in
[LICENSE](LICENSE). You can run it, read it, change it and share it; anything
you distribute has to carry the same licence.

## Developer

[TheMarch88](https://github.com/MarchTheDev)

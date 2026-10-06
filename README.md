# Orbit

<img src="web/src-tauri/icons/icon.png" alt="The Orbit mark" width="96" align="right" />

A library for the games on your PC: it launches them, keeps track of how long
you actually played, and shows where the disk space went.

Orbit is a desktop app. React and Tailwind for the interface, in `web/`; Rust
behind it for everything that touches the machine, in `web/src-tauri/`.

The app icon is [`web/src-tauri/icons/icon.png`](web/src-tauri/icons/icon.png),
drawn from [`icon.svg`](web/src-tauri/icons/icon.svg) beside it; the set the
installer bundles (`.ico`, `.icns`, the Windows tile sizes) is regenerated from
that SVG with `npx tauri icon src-tauri/icons/icon.svg`.

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

The note editor's markdown is checked without a browser: a note goes into the
editor and has to come back out as the same note, and the reading is rendered and
looked at. `npm test` in `web/` runs those checks.

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
aside, with the waiting list ordered by how long a game takes to beat. A game
written down here is a plan: it waits here until it has a program to start, and
it stays out of the library until then. A game added from the library with
nothing to point at yet is the other way round, and only turns up here as well
if Settings says to add new games to the Backlog too.

**Logs** — every game's log in one place: pick a game on the left, read and
write its notes on the right. A log is the player's own record, not the
tracker's: `10h · 08-12-26 · finished main story`, typed in by hand with the date
and the length chosen, and editable afterwards. The one thing Orbit writes
itself is the "Started playing" note, once, the first time a game is launched.

**Storage** — the games in your library grouped by drive, with a Move button on
each one, and how much room every library folder takes. Games are only ever
moved between folders you list here.

**Hidden games** — a game can be put out of the way from its own drawer or from
the right-click menu without leaving the library: its sessions, notes and
playtime all stay, and the Hidden chip on the library page brings it back.

**Music** — a slow pad Orbit makes itself, so nothing is downloaded and nothing
is licensed. Off until it is turned on, with a volume, a choice about whether it
carries on when Orbit is not the window in front, and controls in the top bar
beside Settings with four bars that move while it plays.

**Settings** — the theme, the size of the covers, and how notes, dates and drive
letters are shown, grouped into Appearance, Library and Backlog, Playing,
Artwork and details, Tabs along the top, Sound, Other tools, Updates and About.
The opening animation, the Jump back in panel and the Hidden chip's games are
all managed from there.

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

**Steam** — bringing games over from the Steam library installed on this PC
lives in Add game, next to everything else that adds a game, and what it adds
goes wherever it was opened from: the library's own door files a game on the
shelf, the Backlog's door writes it down as planned. Settings keeps the option to
check the library at launch and the rescan, and it is where Steam games are taken
back out of the library from.

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

## Releases

Everything Orbit ships as is built by GitHub, in
[`.github/workflows/release.yml`](.github/workflows/release.yml), and put on a
**draft release** for you to look at before anybody else can see it. Nothing is
published automatically: publishing is what creates the tag and what makes the
app's own update check notice.

### Cutting a release

1. Put the number in [`VERSION`](VERSION), for example `0.2.0`.
2. Commit and push it. That is the trigger: any push that changes that one file
   starts a build, on any branch, so a release can be cut before this workflow
   has ever reached the default branch.
3. Wait for Actions → Release to go green, then open the repository's Releases
   page. There is a draft there with every file attached.
4. Read the notes, check the files, and press **Publish**. That creates the
   `v0.2.0` tag, makes the release public, and is the moment the app's update
   check starts offering it to anybody running an older Orbit.

To build without changing the version, press Actions → Release → Run workflow
and type a version, or leave it empty to use `VERSION`. GitHub only shows that
button for workflow files on the repository's default branch, so right after a
workflow change it may not be there yet; a push to `VERSION` always works. From
a command line:

```sh
gh workflow run release.yml --ref arena/01a10cff-orbit
```

`packaging/version.mjs` is what keeps the number in one place: the workflow runs
it before each build, and it writes the version into `VERSION`,
`web/src-tauri/tauri.conf.json`, `web/package.json` and
`web/src-tauri/Cargo.toml`, so the number inside the app, the number on the
files in the release and the number in the release's name are the same number.

| Platform | Files |
| --- | --- |
| Windows | `-windows-setup.exe` (the installer), `-windows-standalone.exe` (the program on its own), `-windows.msi`, `-windows-portable.zip` (the program in a folder) |
| Linux | `.AppImage` (one file, any distribution), `.deb` (Debian, Ubuntu, Mint), `.rpm` (Fedora, RHEL, openSUSE), `-linux-portable.tar.gz` |
| Debian | `_debian_amd64.deb`, built in a Debian container against Debian's own libraries |
| Fedora | a native `.rpm`, built in a Fedora container |
| Arch | `.pkg.tar.zst`, installed with `pacman -U` |

The Debian, Fedora and Arch builds are marked as best effort in the workflow:
they run in each distribution's own container, and a package name that has moved
between releases shows up as a failed job rather than as a wrong package. The
Windows and Linux files are what the release itself depends on.

NixOS used to be a fourth job, and the flake is still in the repository:
`nix build` from the root gives the same program. It is not a job any more,
because running the Rust tests on a machine with no drive letters kept failing
over assumptions that were about Windows rather than about the code, and a
release should not wait on that.

### Updates

Orbit has no updater of its own. It cannot patch itself safely without signed
releases, and a self-updater that cannot check a signature is worse than none.
What it does instead, a few seconds after it opens, is ask GitHub's public
releases API for the newest published release. One request, no account, nothing
about your library, and a switch in Settings to turn it off.

If there is something newer, a toast appears that stays until it is answered:
**Go to settings**, **Release notes**, or **Later**. In Settings → Updates the
install button downloads that release's own installer into a temporary folder
and hands it to the system, which is exactly what would have happened if the file
had been downloaded by hand. Or take the release page and pick a file yourself.
Draft releases are invisible to the check, so nothing is offered before it is
published. The version Orbit compares against is the one written into the build
from [`VERSION`](VERSION) at packaging time.

### Building the installers yourself

**Windows.** What is needed once: Rust (`rustup`, the MSVC toolchain), the
"Desktop development with C++" workload from Visual Studio Build Tools, Node 20
or newer, and the WebView2 runtime, which Windows 10 and 11 already have.

```powershell
npm install                # at the repository root; this installs web/ too
cd web
npx tauri build --bundles nsis,msi
```

That leaves three things behind:

| What | Where |
| --- | --- |
| The setup exe | `web/src-tauri/target/release/bundle/nsis/Orbit_<version>_x64-setup.exe` |
| An msi, for anyone who wants one | `web/src-tauri/target/release/bundle/msi/` |
| The program on its own | `web/src-tauri/target/release/orbit.exe` |

The standalone and portable builds are that last file: the interface is inlined
into it, so copying it somewhere as `Orbit.exe` is a working portable install,
and zipping that folder is the portable download. Nothing is written next to it;
the library and the settings live in `%APPDATA%\Orbit`.

**Linux.** What is needed once, on Debian or Ubuntu:

```sh
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf libfuse2
cd web && npm ci && npx tauri build --bundles deb,appimage,rpm
```

**Arch.** `sudo pacman -S --needed base-devel webkit2gtk-4.1 gtk3
libappindicator-gtk3 librsvg openssl nodejs npm rust`, then
`npx tauri build --no-bundle` in `web/`, copy the binary next to
[packaging/arch/PKGBUILD](packaging/arch/PKGBUILD) with `orbit.desktop` and
`orbit.png`, and run `makepkg -f`.

Every one of these stamps the version from [`VERSION`](VERSION) into the app,
so bump that file first if the build needs to say something other than what is
there.

**NixOS.** `nix build` from the repository root, which is what
[`flake.nix`](flake.nix) is for. The first run stops with the hash of the front
end's dependencies in the error; put that in `npmDepsHash` and build again.

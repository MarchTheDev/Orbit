Releases, installers and the update check.

This is the detail behind the short [README](../README.md).

---

# Releasing Orbit

How the installers get built, and what publishing one does.

Everything Orbit ships as is built by GitHub, in
[`.github/workflows/release.yml`](../.github/workflows/release.yml), and put on a
**draft release** for you to look at before anybody else can see it. Nothing is
published automatically: publishing is what creates the tag and what makes the
app's own update check notice.

## Cutting a release

1. Put the number in [`VERSION`](../VERSION), for example `1.1`. Two parts is
   enough: [`packaging/version.mjs`](../packaging/version.mjs) pads it to `1.1.0` for Cargo, npm and Tauri, which all want
   three, while the release keeps the short label.
2. Commit and push it. That is the trigger: any push that changes that one file
   starts a build, on any branch, so a release can be cut before this workflow
   has ever reached the default branch.
3. Wait for Actions → Release to go green, then open the repository's Releases
   page. There is a draft there with every file attached.
4. Read the notes, check the files, and press **Publish**. That creates the
   `v1.1` tag, makes the release public, and is the moment the app's update
   check starts offering it to anybody running an older Orbit.

To build without changing the version, press Actions → Release → Run workflow
and type a version, or leave it empty to use `VERSION`. GitHub only shows that
button for workflow files on the repository's default branch, so right after a
workflow change it may not be there yet; a push to `VERSION` always works. From
a command line:

```sh
gh workflow run release.yml --ref master
```

[`packaging/version.mjs`](../packaging/version.mjs) is what keeps the number in one place: the workflow
runs it before each build, and it writes the version into `VERSION`,
`web/src-tauri/tauri.conf.json`, `web/package.json` and
`web/src-tauri/Cargo.toml`, so the number inside the app, the number on the
files in the release and the number in the release's name are the same number.
`VERSION` holds the label as typed; the other four get the three-part form,
because Cargo, npm and Tauri refuse a version without one.

| Platform | Files |
| --- | --- |
| Windows | `Orbit-<version>-windows-setup.exe` (installer), `Orbit.exe` (standalone program), `Orbit-<version>-windows.msi`, `Orbit-<version>-windows-portable.zip` (program and readme) |
| Linux | `orbit_<version>_amd64.deb`, `orbit-<version>-1.x86_64.rpm`, `Orbit-<version>-linux-portable.tar.gz` |
| Debian | `orbit_<version>_debian_amd64.deb`, built in a Debian container against Debian's own libraries |
| Fedora | `orbit-<version>-1.fc.x86_64.rpm`, built in a Fedora container |
| Arch | `orbit-<version>-1-x86_64.pkg.tar.zst`, installed with `pacman -U` |

The Debian, Fedora and Arch builds are marked as best effort in the workflow:
they run in each distribution's own container, and a package name that has moved
between releases shows up as a failed job rather than as a wrong package. The
Windows and Linux files are what the release itself depends on.

## Updates

Orbit has no updater of its own. It cannot patch itself safely without signed
releases, and a self-updater that cannot check a signature is worse than none.
What it does instead, a few seconds after it opens, is ask GitHub's public
releases API for the newest published release. One request, no account, nothing
about your library, and a switch in Settings to turn it off.

If there is something newer, a toast appears that stays until it is answered:
**Go to settings**, **Release notes**, or **Later**. In Settings → Updates the
install button downloads that release's installer into a temporary folder and
hands it to the system, which is exactly what would have happened if the file had
been downloaded by hand. When a release only has the standalone `Orbit.exe`, its
page opens instead so you can replace the file yourself. Or open the release page
to pick a file yourself.
Draft releases are invisible to the check, so nothing is offered before it is
published. The version Orbit compares against is the one written into the build
from [`VERSION`](../VERSION) at packaging time.

## Building the installers yourself

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

The workflow renames that standalone file `Orbit.exe` and also includes it in the
portable zip with a short readme. The interface is inlined into it, so it works
without an installer. Nothing is written next to it; the library and settings
live in `%APPDATA%\Orbit`.

**Linux.** What is needed once, on Debian or Ubuntu:

```sh
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf libfuse2 rpm
cd web && npm ci && npx tauri build --bundles deb,rpm
```

**Arch.** Install the dependencies and build the binary, then copy it next to
[packaging/arch/PKGBUILD](../packaging/arch/PKGBUILD) with `orbit.desktop` and
`orbit.png` before running `makepkg -f`:

```sh
sudo pacman -S --needed base-devel webkit2gtk-4.1 gtk3 libappindicator-gtk3 \
  librsvg openssl nodejs npm rustup
rustup default stable
cd web && npm ci && npx tauri build --no-bundle
```

Every one of these stamps the version from [`VERSION`](../VERSION) into the app,
so bump that file first if the build needs to say something other than what is
there.

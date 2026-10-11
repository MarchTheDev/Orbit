#!/usr/bin/env bash
# Keep a short, actionable trace of release-build failures in GitHub's job
# annotations and upload the complete output from the calling workflow job.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "Usage: tauri-build.sh <tauri build arguments>" >&2
  exit 2
fi

# The executable bit lives in Git, and Git gives it up more easily than it
# should: a file added through the web interface is stored without it, and a
# checkout on a filesystem with no such bit reports one either way. The bundler
# copies the X11 wrapper into the package preserving whatever mode it found, so
# a lost bit ships a /usr/bin/orbit-x11 nobody can run - and check-x11.sh only
# catches that after a full build, in three separate jobs.
#
# Setting it here costs nothing and makes every package right whatever the
# checkout said. It says so out loud, because the bit being missing in the first
# place is the thing worth knowing about.
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repository=$(dirname "$here")
for entry_point in packaging/linux/orbit-x11 packaging/linux/appimage/AppRun; do
  if [ -f "$repository/$entry_point" ] && [ ! -x "$repository/$entry_point" ]; then
    echo "::notice title=Executable bit::$entry_point was checked out without the executable bit; setting it"
    chmod +x "$repository/$entry_point"
  fi
done

log="${GITHUB_WORKSPACE:-$PWD}/tauri-build.log"
rm -f "$log"

# Capture the CLI's status separately from tee so a failing build still reaches
# the diagnostic summary below.
set +e
npx tauri build "$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
set -e

if [ "$status" -ne 0 ]; then
  diagnostic=$(tail -n 12 "$log" | tr '\r\n' '  ' | cut -c1-3500)
  diagnostic=${diagnostic//%/%25}
  echo "::error title=Tauri build failed::$diagnostic"

  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      echo "## Tauri build output (last 80 lines)"
      echo '```text'
      tail -n 80 "$log"
      echo '```'
    } >> "$GITHUB_STEP_SUMMARY"
  fi
fi

exit "$status"

#!/usr/bin/env bash
# Keep a short, actionable trace of release-build failures in GitHub's job
# annotations and upload the complete output from the calling workflow job.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "Usage: tauri-build.sh <tauri build arguments>" >&2
  exit 2
fi

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

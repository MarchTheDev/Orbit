#!/usr/bin/env bash
# Confirm the X11 entry point really is inside a finished package.
#
# Bundling without complaint and shipping the file are not the same fact, and
# the difference stays invisible until somebody installs the package, opens the
# menu on a Wayland session, and Orbit (X11) is not there. The bundler only
# says it copied something; this looks at what is actually in the archive.
#
# usage: check-x11.sh <label> <package> <listing command...>
#
# The listing command prints permissions and path, one file per line, which is
# what dpkg-deb --contents, rpm -qlvp and tar -tvf all do.
set -euo pipefail

if [ "$#" -lt 3 ]; then
  echo "Usage: check-x11.sh <label> <package> <listing command...>" >&2
  exit 2
fi

label="$1"
shift
package="$1"
shift
listing=$("$@" "$package")
name=$(basename "$package")
failed=0

# Permissions differ between tools but every one of them writes `rwx` for a
# file it is possible to run, which is the only part this cares about.
report() {
  local what="$1" pattern="$2" runnable="$3" line
  line=$(printf '%s\n' "$listing" | grep -E "$pattern" || true)
  if [ -z "$line" ]; then
    echo "::error title=$label::$what is not in $name"
    failed=1
    return
  fi
  if [ "$runnable" = yes ] && ! printf '%s\n' "$line" | grep -q rwx; then
    echo "::error title=$label::$what is in $name but cannot be run: $line"
    failed=1
    return
  fi
  echo "  $what: $(printf '%s\n' "$line" | tr -s ' ')"
}

report "the X11 wrapper" 'usr/bin/orbit-x11$' yes
report "the X11 menu entry" 'applications/orbit-x11\.desktop$' no

if [ "$failed" -ne 0 ]; then
  exit 1
fi

echo "::notice title=$label::both X11 entry points are in $name"

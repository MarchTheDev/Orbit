#!/usr/bin/env bash
# Confirm the dependencies a package declares actually exist in the
# distribution it is about to be installed on.
#
# A dependency with a name nothing has heard of does not fail the build. It
# fails the install, on the tester's machine, with a message that sounds like
# Orbit is broken. The names are typed by hand into three different package
# managers' naming schemes — gst-plugins-good, gstreamer1.0-plugins-good,
# gstreamer1-plugins-good — which is exactly the sort of thing to check against
# the real repositories instead of against a memory of them.
#
# usage: check-deps.sh <label> <apt|dnf|pacman> <package> <name>...
set -euo pipefail

if [ "$#" -lt 4 ]; then
  echo "Usage: check-deps.sh <label> <apt|dnf|pacman> <package> <name>..." >&2
  exit 2
fi

label="$1"
shift
mode="$1"
shift
package="$1"
shift
name=$(basename "$package")
failed=0

case "$mode" in
  apt | dnf | pacman) ;;
  *)
    echo "::error title=$label::no such package manager: $mode"
    exit 2
    ;;
esac

# Read out of the finished package rather than out of the config, so a setting
# that never reached the bundler is caught here as well.
case "$mode" in
  apt)
    declared=$(dpkg-deb --field "$package" Depends | tr ',' '\n' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
    ;;
  dnf)
    declared=$(rpm -qp --requires "$package")
    ;;
  pacman)
    declared=$(tar -xOf "$package" .PKGINFO | sed -n 's/^depend = //p')
    ;;
esac

for want in "$@"; do
  if ! printf '%s\n' "$declared" | grep -qxF "$want"; then
    echo "::error title=$label::$want is not among the dependencies of $name"
    failed=1
    continue
  fi

  case "$mode" in
    # apt is asked about the whole set at once below, since it names every
    # package it cannot find in a single run.
    apt) ;;
    dnf)
      if [ -z "$(dnf repoquery --quiet --whatprovides "$want" 2>/dev/null || true)" ]; then
        echo "::error title=$label::nothing in the repositories provides $want"
        failed=1
      fi
      ;;
    pacman)
      if ! pacman -Sp --noconfirm "$want" >/dev/null 2>&1; then
        echo "::error title=$label::nothing in the repositories provides $want"
        failed=1
      fi
      ;;
  esac
done

if [ "$mode" = apt ]; then
  if ! apt-get install -s --no-install-recommends "$@" >/dev/null 2>&1; then
    echo "::error title=$label::apt cannot install $* on this system"
    failed=1
  fi
fi

if [ "$failed" -ne 0 ]; then
  exit 1
fi

echo "::notice title=$label::every dependency is declared and installable"

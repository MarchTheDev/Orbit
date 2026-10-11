#!/usr/bin/env bash
# Confirm a built AppImage really carries what it has to.
#
# appimagetool exits 0 for an image that is missing its entry point, and an
# image without a runnable AppRun does not fail until somebody double-clicks it
# and nothing happens. This unpacks the finished file and looks at what is
# actually inside, the way check-x11.sh looks inside the other packages.
#
# Extracting needs no FUSE device, which is what makes it possible to do this
# on a runner rather than only on a desktop.
#
# usage: check-appimage.sh <label> <appimage>
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: check-appimage.sh <label> <appimage>" >&2
  exit 2
fi

label="$1"
appimage="$2"
name=$(basename "$appimage")
failed=0

case "$appimage" in
  /*) absolute="$appimage" ;;
  *) absolute="$PWD/$appimage" ;;
esac

if [ ! -f "$absolute" ]; then
  echo "::error title=$label::$name is not a file, so there is nothing to unpack"
  exit 1
fi
# Unpacking runs the file's own runtime, which the kernel will only do for
# something marked executable, and release artifacts are often not.
if ! chmod +x "$absolute" 2>/dev/null; then
  echo "::error title=$label::$name could not be made executable, so it cannot be unpacked"
  exit 1
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
(cd "$work" && "$absolute" --appimage-extract >/dev/null)
root="$work/squashfs-root"

if [ ! -d "$root" ]; then
  echo "::error title=$label::$name did not unpack, so nothing about it can be checked"
  exit 1
fi

report() {
  local what="$1" path="$2" runnable="$3"
  if [ ! -e "$root/$path" ]; then
    echo "::error title=$label::$what is not in $name ($path)"
    failed=1
    return
  fi
  if [ "$runnable" = yes ] && [ ! -x "$root/$path" ]; then
    echo "::error title=$label::$what is in $name but cannot be run: $path"
    failed=1
    return
  fi
  echo "  $what: $path"
}

report "the entry point" AppRun yes
report "the binary" usr/bin/orbit yes
report "the X11 wrapper" usr/bin/orbit-x11 yes
report "the menu entry" orbit.desktop no
report "the X11 menu entry" orbit-x11.desktop no
report "the icon" orbit.png no

# Inside an image the launcher is replaced by the image itself, so a menu entry
# still pointing at `orbit` would start whatever happens to be on the PATH.
exec_line() {
  local file="$1" want="$2" got
  got=$(sed -n 's/^Exec=//p' "$root/$file" 2>/dev/null || true)
  if [ "$got" != "$want" ]; then
    echo "::error title=$label::$file says Exec=$got, not Exec=$want"
    failed=1
  else
    echo "  $file: Exec=$got"
  fi
}
exec_line orbit.desktop "AppRun"
exec_line orbit-x11.desktop "AppRun --x11"

# The blank-window default is the reason this entry point is not just an exec.
if grep -q 'WEBKIT_DISABLE_DMABUF_RENDERER:=1' "$root/AppRun"; then
  echo "  AppRun: defaults WEBKIT_DISABLE_DMABUF_RENDERER to 1"
else
  echo "::error title=$label::AppRun no longer defaults WEBKIT_DISABLE_DMABUF_RENDERER"
  failed=1
fi

if [ "$failed" -ne 0 ]; then
  exit 1
fi

echo "::notice title=$label::$name unpacks and carries both entry points"

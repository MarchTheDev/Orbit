Orbit, portable
===============

Nothing is installed. Everything Orbit currently keeps lives in the data folder
beside this file - the library, the settings, and the save backups - so the
whole folder can be moved, copied, or carried on a stick and it takes the
library with it.

The in-game overlay and its screenshot, recording, and replay controls are
temporarily unavailable in Linux builds. Existing overlay preferences and older
capture files are left untouched.

The orbit.portable file is what says so. Remove it and Orbit uses the usual
~/.local/share/com.orbit.launcher instead, like an installed copy.

To run it:

    ./orbit

On a Wayland session where the window will not draw, run ./orbit-x11 instead,
or use the orbit-x11.desktop entry. Both are the same program.


If there is no sound
--------------------

Orbit's music is synthesized in the page, and WebKit plays it through
GStreamer. WebKit needs an element called autoaudiosink, which is not part of
WebKit itself and is not installed by it. Without it the app runs fine and is
simply silent.

Check whether you have it:

    gst-inspect-1.0 autoaudiosink

If that prints "No such element or plugin", install the plugins for your
distribution:

    Arch            pacman -S gst-plugins-base gst-plugins-good gst-plugin-pipewire
    Debian/Ubuntu   apt install gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-pipewire
    Fedora          dnf install gstreamer1-plugins-base gstreamer1-plugins-good pipewire-gstreamer

The packaged builds ask for these themselves, so this only applies here.

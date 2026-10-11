Orbit AppImage

This packages the Orbit binary, but it is not fully self-contained. The host
must provide GTK 3, WebKitGTK 4.1, and the GStreamer plugins that Orbit plays
its music through. An AppImage cannot bundle those safely across distributions,
and a build that tried would be hundreds of megabytes and still break on the
distribution it was not tested against.

The image carries both launchers. `Orbit` is the normal one; `Orbit (X11)` is
the fallback for the sessions where WebKitGTK's Wayland rendering misbehaves.

If the window opens blank, WEBKIT_DISABLE_DMABUF_RENDERER is already set to 1
inside this image. If it is still blank after that, try the X11 entry.

{
  description = "Orbit - a library for the games on your PC";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        version = "0.1.2";

        # The interface, built by npm. Its own derivation so that changing a
        # line of Rust does not rebuild the front end and the other way round.
        orbit-web = pkgs.buildNpmPackage {
          pname = "orbit-web";
          inherit version;
          src = ./web;
          # The interface reads its version from VERSION at the top of the
          # repository, and this derivation is only handed web/, so the number
          # is passed in rather than read from a file that is not here.
          ORBIT_VERSION = version;
          # Nix will tell you the real hash the first time it builds, and the
          # release workflow fills this in automatically. To do it by hand:
          #   nix build .# 2>&1 | grep 'got:'
          npmDepsHash = pkgs.lib.fakeHash;
          installPhase = ''
            runHook preInstall
            mkdir -p $out
            cp -r dist $out/dist
            runHook postInstall
          '';
        };

        orbit = pkgs.rustPlatform.buildRustPackage {
          pname = "orbit";
          inherit version;
          src = ./.;
          cargoRoot = "web/src-tauri";
          buildAndTestSubdir = "web/src-tauri";
          cargoLock.lockFile = ./web/src-tauri/Cargo.lock;

          nativeBuildInputs = [
            pkgs.pkg-config
            pkgs.wrapGAppsHook3
            pkgs.makeWrapper
          ];

          # What Tauri draws itself with on Linux.
          buildInputs = [
            pkgs.gtk3
            pkgs.webkitgtk_4_1
            pkgs.libsoup_3
            pkgs.openssl
            pkgs.libayatana-appindicator
            pkgs.librsvg
            # The xdo library is inside `xdotool`; there is no `libxdo`
            # attribute, which is what the first build of this flake found out.
            pkgs.xdotool
          ];

          # Tauri's build script reads `frontendDist`, which is `web/dist`, so
          # the built interface has to be in place before cargo runs.
          preBuild = ''
            mkdir -p web/dist
            cp -r ${orbit-web}/dist/. web/dist/
          '';

          postInstall = ''
            install -Dm644 ${./packaging/linux/orbit.desktop} \
              $out/share/applications/orbit.desktop
            install -Dm644 ${./web/src-tauri/icons/128x128.png} \
              $out/share/icons/hicolor/128x128/apps/orbit.png
            # WebKit and GTK have to find their own libraries and schemas at run
            # time, which is what wrapGAppsHook3 sets up.
            wrapProgram $out/bin/orbit \
              --prefix LD_LIBRARY_PATH : ${pkgs.lib.makeLibraryPath [ pkgs.webkitgtk_4_1 pkgs.gtk3 ]}
          '';

          meta = {
            description = "A library for the games on your PC: launches them, times them, and shows where the disk space went";
            homepage = "https://github.com/MarchTheDev/Orbit";
            license = pkgs.lib.licenses.mit;
            mainProgram = "orbit";
            platforms = pkgs.lib.platforms.linux;
          };
        };
      in
      {
        packages = {
          default = orbit;
          inherit orbit;
        };

        apps.default = flake-utils.lib.mkApp { drv = orbit; };

        devShells.default = pkgs.mkShell {
          packages = [
            pkgs.nodejs
            pkgs.cargo
            pkgs.rustc
            pkgs.pkg-config
            pkgs.gtk3
            pkgs.webkitgtk_4_1
            pkgs.libsoup_3
            pkgs.openssl
            pkgs.libayatana-appindicator
            pkgs.librsvg
            # The xdo library is inside `xdotool`; there is no `libxdo`
            # attribute, which is what the first build of this flake found out.
            pkgs.xdotool
          ];
          shellHook = ''
            echo "Orbit: npm install in web/, then npm run tauri dev."
          '';
        };
      });
}

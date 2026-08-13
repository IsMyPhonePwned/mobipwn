# mobi-android-collector

Vendored copy of [CERT-EDF/rusty-magpie](https://github.com/CERT-EDF/rusty-magpie) — an on-device Android artifact collector (process list, file inventory, optional YARA scan).

Mobipwn uses the `ps`, `find`, and optional `yara` commands from the public `/collect` page via WebUSB ADB: the browser pushes the binary to `/data/local/tmp/rusty_magpie`, runs collection, pulls JSON results, and bundles them with the bugreport upload.

Administrators configure defaults under **Settings → Plugins → Collector → Configure** (Android and iOS sections). Rules are compiled server-side with YARA-X into a `.yarc` bundle that is pushed to the device during YARA scans.

## Device binary (Rusty Magpie)

Output path: `mobipwn-web/public/vendor/rusty-magpie/rusty_magpie` (served to the browser, gitignored).

### Prebuilt from GitHub (recommended when you lack the NDK)

```bash
./scripts/fetch-rusty-magpie.sh
# or
./scripts/ensure-rusty-magpie.sh
```

Configure via `mobipwn-web/public/vendor/rusty-magpie/prebuilt.json` (tag + sha256 after a release) or environment:

- `RUSTY_MAGPIE_PREBUILT_URL` — direct download URL
- `MOBIPWN_RUSTY_MAGPIE_MODE` — `auto` (default), `fetch`, `build`, or `skip`
- `MOBIPWN_SKIP_RUSTY_MAGPIE_BUILD=1` — same as `skip`

Docker/Podman stack web image uses `MOBIPWN_RUSTY_MAGPIE_MODE=fetch` by default (no NDK in the Node image).

### Build locally (Android NDK)

Requires the Android NDK and `cargo-ndk`:

```bash
export ANDROID_NDK_HOME="/path/to/ndk"
rustup target add aarch64-linux-android
cargo install cargo-ndk

./scripts/build-android-collector.sh
```

The default Mobipwn build omits YARA (`--no-default-features --features ps,find`) for a smaller binary. To include YARA scanning:

```bash
./scripts/build-android-collector.sh --with-yara
```

### Publish prebuilt to GitHub (maintainers)

```bash
export ANDROID_NDK_HOME="/path/to/ndk"
./scripts/publish-rusty-magpie.sh 0.1.0
```

Creates release `rusty-magpie-v0.1.0` with asset `rusty_magpie-aarch64-linux-android` and updates `prebuilt.json`.

## Upstream

Original project: https://github.com/CERT-EDF/rusty-magpie (Apache-2.0).

When updating the vendored tree, preserve `Cargo.toml` feature flags and this README.

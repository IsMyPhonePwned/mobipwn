# Rusty Magpie device binary

This directory holds the cross-compiled `rusty_magpie` binary served to the `/collect` page.

## Option A — prebuilt (no Android NDK)

After a maintainer publishes a [GitHub release](https://github.com/ismyphonepwned/mobipwn/releases) (`rusty-magpie-v*`), fetch the asset:

```bash
./scripts/fetch-rusty-magpie.sh
```

Or set a direct URL:

```bash
export RUSTY_MAGPIE_PREBUILT_URL="https://github.com/ismyphonepwned/mobipwn/releases/download/rusty-magpie-v0.1.0/rusty_magpie-aarch64-linux-android"
./scripts/fetch-rusty-magpie.sh
```

`prebuilt.json` in this directory records the default release tag and sha256 once published.

`./scripts/ensure-rusty-magpie.sh` (used by `dev.sh` and `npm run build`) tries fetch first, then local build if `ANDROID_NDK_HOME` is set.

## Option B — build locally

```bash
export ANDROID_NDK_HOME="/path/to/ndk"
./scripts/build-android-collector.sh
```

See `mobi-android-collector/README.mobipwn.md` for NDK setup.

## Publishing a release (maintainers)

```bash
export ANDROID_NDK_HOME="/path/to/ndk"
./scripts/publish-rusty-magpie.sh 0.1.0
```

Creates tag `rusty-magpie-v0.1.0`, uploads `rusty_magpie-aarch64-linux-android`, and updates `prebuilt.json`.

## Skip entirely

```bash
export MOBIPWN_RUSTY_MAGPIE_MODE=skip
# or MOBIPWN_SKIP_RUSTY_MAGPIE_BUILD=1
```

The binary file is gitignored (large). The `/collect` page shows a warning when it is missing.

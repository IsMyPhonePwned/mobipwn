# idevice-rs WebUSB WASM (Apple lockdown / sysdiagnose)

`./dev.sh` rebuilds this on every `up` / `restart` (same profile as webadb: `MOBIPWN_WASM_PROFILE`, default **release**).

## One-time macOS prerequisite

Apple clang cannot compile `ring` for `wasm32`. Install Homebrew LLVM once:

```bash
brew install llvm
```

Then either restart the stack (`./dev.sh restart`) or build manually:

```bash
./scripts/build-idevice-wasm.sh release
```

Manual build also accepts `dev` for a faster unoptimized bundle. Sibling checkout required: `../idevice-rs` (or `IDEVICE_RS_ROOT`).

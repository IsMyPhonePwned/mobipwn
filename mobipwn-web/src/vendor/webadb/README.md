# WebADB WASM bundle (vendored)

Prebuilt output from the `mobipwn-webadb` crate, committed so **npm install / dev / build work without wasm-pack**.

| File | Role |
|------|------|
| `webadb_rs.js` | wasm-bindgen loader + JS API |
| `webadb_rs_bg.wasm` | compiled WebUSB ADB module |
| `webadb_rs.d.ts` | TypeScript stubs (hand-maintained; wasm-pack types are not checked in) |

## Rebuild (only after changing `mobipwn-webadb/`)

```bash
./scripts/build-webadb-wasm.sh          # dev
./scripts/build-webadb-wasm.sh release  # production
```

Requires [wasm-pack](https://rustwasm.github.io/wasm-pack/): `cargo install wasm-pack`

Then commit the updated `webadb_rs.js` and `webadb_rs_bg.wasm` (and `package.json` if it changed).

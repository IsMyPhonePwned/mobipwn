# iOS logarchive unified-log decode

iOS sysdiagnose archives often include **unified log archives** (`logarchive` bundles). mobipwn can ingest them in two modes:

| Mode | Cargo feature | What gets indexed |
|------|---------------|-------------------|
| **Default (inventory only)** | *(none)* | File inventory + metadata (`parser=logarchive`, `action=logarchive_inventory`) |
| **Decode enabled** | `logarchive-decode` | Above plus decoded log lines (`action=logarchive_event`) via [macos-unifiedlogs](https://github.com/mandiant/macos-unifiedlogs) in [sysdiagnose-extractor-library](https://github.com/ismyphonepwned/sysdiagnose-extractor-library) |

Decode is **off by default** — it pulls in native unified-log parsing, increases ingest time and disk use, and is only needed when you want searchable log lines in the case **Log archive** panel and mPL hunts on `action="logarchive_event"`.

---

## Host dev (`./dev.sh`)

```bash
# Default: inventory only
./dev.sh

# Enable decode (rebuilds mobipwn-api with --features logarchive-decode)
./dev.sh --logarchive-decode

# Same via env (also written to .dev/ports.env on start)
MOBIPWN_LOGARCHIVE_DECODE=1 ./dev.sh

# Check current setting
./dev.sh status
# logarchive decode: off (enable: ./dev.sh --logarchive-decode)
# logarchive decode: enabled
```

The flag is **persisted** in `.dev/ports.env`. After enabling once, `./dev.sh restart` keeps decode on until you start without the flag and overwrite `ports.env` (or edit `MOBIPWN_LOGARCHIVE_DECODE=0` there).

After toggling the feature, **re-ingest** sysdiagnose archives so ClickHouse gets `logarchive_event` rows (inventory-only ingests do not backfill decoded lines).

---

## Cargo / CLI

Features chain: `mobipwn-api` → `mobipwn-ingest` → `sysdiagnose_logarchive_decode`.

- **Default:** `mobipwn-ingest` uses a local **stub** crate (`logarchive-decode-stub`) — no `macos-unifiedlogs`, no git fetch.
- **With decode:** `./dev.sh --logarchive-decode` swaps the path to `sysdiagnose-extractor-library/logarchive-decode` and builds with `--features logarchive-decode`.

Fast verify (no compile):

```bash
./scripts/verify-logarchive-deps.sh
```

```bash
# API (ingest through HTTP uses the API binary)
cargo build -p mobipwn-api --features logarchive-decode
cargo run -p mobipwn-api --features logarchive-decode

# Direct CLI ingest (bypasses API)
cargo run --release -p mobipwn-ingest --features logarchive-decode -- \
  sysdiagnose -i /path/to/sysdiagnose.tar.gz -s my-case-001
```

Example script (add `--features logarchive-decode` to the `cargo run` line or export it in your shell before `cargo build`):

```bash
./examples/ingest-sysdiagnose.sh /path/to/sysdiagnose.tar.gz my-case-001
```

---

## Docker / compose

The default `./compose.sh` image build does **not** enable `logarchive-decode`. To use decode in containers you must rebuild `mobipwn-api` with the feature (e.g. adjust the Dockerfile `cargo build` line or pass `--features logarchive-decode` in your build args). Host `./dev.sh` is the supported path for local decode during development.

---

## UI and search

- **Case → Log archive** — shows inventory always; decoded events appear when ingest ran with the feature enabled.
- **mPL** — `platform="ios" AND action="logarchive_event"` (or filter on `parser="logarchive"` for inventory rows).

If decode was not enabled at ingest time, the panel shows a deferred message pointing at `./dev.sh --logarchive-decode`.

### Settings → iOS sysdiagnose ingest

Even with the Cargo feature on, decode is still capped for RAM/time:

| Setting | Default | Forensic / uncapped |
|---------|---------|---------------------|
| Logarchive decode line cap | 2500 | unlimited (`0`) |
| Max archive member size | 64 MiB | ≥ 2048 MiB (large `Persist/*.tracev3` otherwise skipped) |

Enable **Uncapped logarchive (forensic)** before re-ingest when hunting across full unified logs. TrollStore / install timelines often also need `module="mobileinstallation"` (separate from logarchive).

---

## Related

- [sysdiagnose-extractor-library — logarchive](https://github.com/ismyphonepwned/sysdiagnose-extractor-library/blob/main/docs/logarchive.md)
- [examples/README.md](../examples/README.md) — sysdiagnose ingest walkthrough
- [ARCHITECTURE.md](./ARCHITECTURE.md) — ingest pipeline overview

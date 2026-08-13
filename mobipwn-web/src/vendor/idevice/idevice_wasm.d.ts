/* tslint:disable */
/* eslint-disable */

export function lockdownBattery(device: USBDevice, mode: string, host_id: string, system_buid: string, verbose: boolean, pair_record_plist_xml: string, tls_client_auth: string, tls_sni: string): Promise<string>;

/**
 * `QueryType` → optional `Pair` (generated keys) → `StartSession` → optional TLS → `GetValue battery`.
 * Pass **`pair_record_plist_xml`** to reuse an existing pair record; otherwise keys are generated based on `mode`.
 */
export function lockdownBatteryPickDevice(mode: string, host_id: string, system_buid: string, verbose: boolean, pair_record_plist_xml: string, tls_client_auth: string, tls_sni: string): Promise<string>;

/**
 * `crashreportmover` + AFC crash report copy. Works with either a pre-existing pair-record plist or
 * with generated keys (pair mode `random` / `legacy`) — the latter runs a full `Pair` + Trust flow first.
 */
export function lockdownCrashReports(device: USBDevice, mode: string, host_id: string, system_buid: string, pair_record_plist_xml: string, verbose: boolean, tls_client_auth: string, tls_sni: string, keep: boolean, filter_substr: string, remove_all: boolean): Promise<any>;

export function lockdownCrashReportsInfo(): string;

export function lockdownDiagnostics(device: USBDevice, mode: string, host_id: string, system_buid: string, verbose: boolean, pair_record_plist_xml: string, tls_client_auth: string, tls_sni: string): Promise<string>;

/**
 * Same as battery, then the diagnostic `GetValue` batch.
 */
export function lockdownDiagnosticsPickDevice(mode: string, host_id: string, system_buid: string, verbose: boolean, pair_record_plist_xml: string, tls_client_auth: string, tls_sni: string): Promise<string>;

/**
 * **`QueryType`** → **`StartSession`** → **`GetValue`** batch (cleartext or TLS). Requires a **full** XML pair-record plist
 * (HostID, SystemBUID, and PEM keys). **`tls_client_auth`**: `host` | `root` | `chain`. **`tls_sni`**: `device` | `none`.
 */
export function lockdownFetchWithPlistXml(device: USBDevice, plist_xml: string, verbose: boolean, tls_client_auth: string, tls_sni: string): Promise<string>;

/**
 * Pair with **freshly generated** RSA keys (random / legacy ids), wait for Trust on the device,
 * and return the resulting pair-record **XML plist** (HostID / SystemBUID / PEM keys) so the page
 * can save it for subsequent `StartSession` + TLS without re-prompting the user.
 */
export function lockdownPair(device: USBDevice, mode: string, verbose: boolean): Promise<string>;

/**
 * `QueryType` → optional `Pair` (generated keys) → `StartSession` → TLS upgrade →
 * `StartService(com.apple.pcapd)` → secondary mux TCP + TLS → libpcap stream.
 *
 * **Stops** when:
 * - `on_packet` returns `false` → `stoppedReason = "user-stop"`
 * - `packets >= max_packets` (when `max_packets > 0`) → `"max-packets"`
 * - `pcap_bytes >= max_bytes` (when `max_bytes > 0`) → `"max-bytes"`
 * - `max_duration_ms` elapsed → `"max-duration"`
 * - the device closes the relay (cleartext path only) → `"stream-closed"`
 *
 * `data` in the resulting object is a **complete libpcap file** (`LINKTYPE_ETHERNET`, snaplen
 * 65535). The page can blob+download it directly into Wireshark / `tcpdump -r`.
 */
export function lockdownPcap(device: USBDevice, mode: string, host_id: string, system_buid: string, pair_record_plist_xml: string, verbose: boolean, tls_client_auth: string, tls_sni: string, on_packet: Function, process_filter: string, interface_filter: string, max_packets: number, max_bytes: number, max_duration_ms: number): Promise<any>;

export function lockdownQueryType(device: USBDevice, verbose: boolean): Promise<string>;

/**
 * `QueryType` on lockdownd (cleartext). **`verbose`**: log mux/TCP details to the browser console.
 */
export function lockdownQueryTypePickDevice(verbose: boolean): Promise<string>;

/**
 * `QueryType` → optional `Pair` (generated keys) → `StartSession` → TLS upgrade →
 * `StartService(com.apple.mobile.screenshotr)` → secondary TLS → DeviceLink handshake →
 * `ScreenShotRequest` → `ScreenShotReply.ScreenShotData`.
 *
 * Returns `{ data: Uint8Array, extension: "png" | "tiff" | "dat", mime, byteLength }`. The
 * caller decides whether to render it (`<img src="data:image/...">`), download it, or both.
 *
 * **Requires a mounted Developer Disk Image**; otherwise lockdownd answers `InvalidService`
 * and we surface a friendly error.
 */
export function lockdownScreenshot(device: USBDevice, mode: string, host_id: string, system_buid: string, pair_record_plist_xml: string, verbose: boolean, tls_client_auth: string, tls_sni: string): Promise<any>;

/**
 * Download one sysdiagnose `.tar.gz` by device AFC path (up to ~512 MiB).
 */
export function lockdownSysdiagnoseDownload(device: USBDevice, mode: string, host_id: string, system_buid: string, pair_record_plist_xml: string, verbose: boolean, tls_client_auth: string, tls_sni: string, device_path: string, on_progress?: Function | null): Promise<any>;

export function lockdownSysdiagnoseInfo(): string;

/**
 * List sysdiagnose `.tar.gz` archives on the device (metadata only; no download).
 */
export function lockdownSysdiagnoseList(device: USBDevice, mode: string, host_id: string, system_buid: string, pair_record_plist_xml: string, verbose: boolean, tls_client_auth: string, tls_sni: string): Promise<any>;

/**
 * `QueryType` → optional `Pair` (generated keys) → `StartSession` → TLS upgrade →
 * `StartService(com.apple.syslog_relay)` → secondary mux TCP + (TLS or cleartext) → stream
 * decoded chunks to `on_chunk(text, totalBytes)`.
 *
 * **Stops** when:
 * - `on_chunk` returns `false` → `stoppedReason = "user-stop"`
 * - `accumulated.len() >= max_bytes` (when `max_bytes > 0`) → `"max-bytes"`
 * - `max_duration_ms` elapsed → `"max-duration"`
 * - the device closes the relay (cleartext path only) → `"stream-closed"`
 *
 * Returns `{ bytes, durationMs, stoppedReason, ssl, data: Uint8Array }`. The full byte capture
 * is in `data` so the page can offer **Save** without re-decoding strings.
 */
export function lockdownSyslog(device: USBDevice, mode: string, host_id: string, system_buid: string, pair_record_plist_xml: string, verbose: boolean, tls_client_auth: string, tls_sni: string, on_chunk: Function, max_bytes: number, max_duration_ms: number): Promise<any>;

/**
 * After **`requestAppleDevice()`**, run mux + TCP handshake to **lockdownd**.
 */
export function muxLockdownHandshake(device: USBDevice, verbose: boolean): Promise<string>;

/**
 * Request an Apple USB device (picker) and complete mux **VERSION** (+ **SETUP**) + TCP handshake to **lockdownd**.
 * **`verbose`**: log mux/TCP framing to the browser **`console`** (same spirit as `--lockdown-tls-debug` on the host).
 */
export function muxLockdownHandshakePickDevice(verbose: boolean): Promise<string>;

/**
 * Parse **`HostID`** / **`SystemBUID`** from XML pair-record plist bytes (libimobiledevice-style keys).
 * Returns a JS object `{ hostId, systemBuid }` for use with **`lockdownFetchWithPlistXml`** or manual fields.
 */
export function pairingIdsFromPlistXml(plist_xml: string): any;

/**
 * Start generating RSA host keys in the background (call right after `requestAppleDevice`).
 * `lockdownPair` consumes the cache so the Trust prompt is not delayed by key generation.
 */
export function prefetchPairHostKeys(): void;

/**
 * `navigator.usb.requestDevice` with Apple **VID 0x05ac** (must run from a user gesture).
 *
 * Fails with a human-friendly diagnostic when `navigator.usb` isn't accessible — the WebUSB
 * API is only exposed in a [secure context](https://developer.mozilla.org/docs/Web/Security/Secure_Contexts)
 * (HTTPS or `localhost`/`127.0.0.1`) on Chromium-based browsers, so users hitting this from
 * `file://` or Firefox/Safari otherwise saw an opaque `Cannot read properties of undefined`
 * crash deep in the wasm-bindgen runtime.
 */
export function requestAppleDevice(): Promise<USBDevice>;

/**
 * One-time panic hook → `console.error` (helps debug WASM panics in DevTools).
 */
export function wasm_start_hook(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly lockdownScreenshot: (a: any, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number) => any;
    readonly requestAppleDevice: () => any;
    readonly muxLockdownHandshake: (a: any, b: number) => any;
    readonly muxLockdownHandshakePickDevice: (a: number) => any;
    readonly lockdownBattery: (a: any, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number) => any;
    readonly lockdownBatteryPickDevice: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => any;
    readonly lockdownCrashReports: (a: any, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number) => any;
    readonly lockdownCrashReportsInfo: () => [number, number];
    readonly lockdownDiagnostics: (a: any, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number) => any;
    readonly lockdownDiagnosticsPickDevice: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => any;
    readonly lockdownFetchWithPlistXml: (a: any, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => any;
    readonly lockdownPair: (a: any, b: number, c: number, d: number) => any;
    readonly lockdownPcap: (a: any, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: any, p: number, q: number, r: number, s: number, t: number, u: number, v: number) => any;
    readonly lockdownQueryType: (a: any, b: number) => any;
    readonly lockdownQueryTypePickDevice: (a: number) => any;
    readonly lockdownSysdiagnoseDownload: (a: any, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number) => any;
    readonly lockdownSysdiagnoseInfo: () => [number, number];
    readonly lockdownSysdiagnoseList: (a: any, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number) => any;
    readonly lockdownSyslog: (a: any, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: any, p: number, q: number) => any;
    readonly pairingIdsFromPlistXml: (a: number, b: number) => [number, number, number];
    readonly prefetchPairHostKeys: () => void;
    readonly wasm_start_hook: () => void;
    readonly ring_core_0_17_14__bn_mul_mont: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h7ec4a879f072e30e: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__h2a2304fc6f66837e: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__h2a2304fc6f66837e_2: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__h2a2304fc6f66837e_3: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__h2a2304fc6f66837e_4: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__h6b57ed543875dd99: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__ha9dccf4f563d93d1: (a: number, b: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;

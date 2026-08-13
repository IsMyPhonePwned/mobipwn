/**
 * Type stubs for the wasm-pack output (`webadb_rs.js` + `webadb_rs_bg.wasm`).
 * Committed so `tsc` passes before `./scripts/build-webadb-wasm.sh` is run.
 * Regenerate the runtime bundle after changing mobipwn-webadb.
 */
export class Adb {
  constructor();
  connect(): Promise<unknown>;
  connectWithUsbDevice(usb_device: USBDevice): Promise<unknown>;
  disconnect(): Promise<void>;
  is_connected(): boolean;
  list_bugreports(): Promise<unknown>;
  download_bugreport(path: string): Promise<Uint8Array>;
  bugreport(): Promise<Uint8Array>;
  bugreport_lite(): Promise<string>;
  shell(command: string): Promise<string>;
  shell_with_timeout(command: string, timeout_ms: number): Promise<string>;
  pull_file(path: string): Promise<Uint8Array>;
  push_file(data: Uint8Array, remote_path: string): Promise<void>;
  stat_file(path: string): Promise<unknown>;
  list_directory(path: string): Promise<unknown>;
  create_directory(remote_path: string): Promise<void>;
  delete_path(remote_path: string): Promise<void>;
  rename_file(old_path: string, new_path: string): Promise<void>;
  get_properties(): Promise<unknown>;
  logcat(lines: number): Promise<string>;
  logcat_clear(): Promise<void>;
  reboot(target?: string | null): Promise<void>;
  health_check(): Promise<boolean>;
  active_stream_count(): number;
  cleanup_stale_streams(): Promise<number>;
}

export function generate_keypair(): void;
export function has_keypair(): boolean;
export function init(): void;
export function remove_keypair(): void;

export default function initWasm(
  module_or_path?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module
): Promise<unknown>;

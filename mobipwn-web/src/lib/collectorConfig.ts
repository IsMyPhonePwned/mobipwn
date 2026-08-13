import { parseApiResponse } from "@/lib/response";
import type { AndroidCollectConfig, PublicAndroidCollectConfig } from "./androidCollectConfig";

export type IosCollectConfig = {
  upload_enabled: boolean;
  instructions: string;
};

export type PublicIosCollectConfig = {
  upload_enabled: boolean;
  instructions: string;
};

export type PublicSysdiagnoseIngestConfig = {
  logarchive_decode_max_lines: number;
  ioservice_full_tree: boolean;
  logarchive_uncapped: boolean;
  max_entry_mb: number;
};

export type PublicCollectorConfig = {
  android: PublicAndroidCollectConfig;
  ios: PublicIosCollectConfig;
  /** Defaults from Settings — applied as starting values on /collect iOS. */
  sysdiagnose?: PublicSysdiagnoseIngestConfig;
};

export type CollectorConfig = {
  enabled: boolean;
  tags: string[];
  android_collect: AndroidCollectConfig;
  ios_collect: IosCollectConfig;
};

export const DEFAULT_IOS_COLLECT: IosCollectConfig = {
  upload_enabled: true,
  instructions:
    "Upload a sysdiagnose .tar.gz archive collected on the device (Settings → Privacy & Security → Analytics & Improvements → Analytics Data).",
};

export async function fetchPublicCollectorConfig(): Promise<PublicCollectorConfig> {
  const res = await fetch("/api/v1/public/collect/collector-config");
  return parseApiResponse<PublicCollectorConfig>(res);
}

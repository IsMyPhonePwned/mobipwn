import { parseApiResponse } from "@/lib/response";

export type PublicCollectStatus = {
  enabled: boolean;
};

export type PublicCollectIngestResponse = {
  ingested: number;
  deduplicated: boolean;
  source: string;
  case_id: string;
  case_title: string;
};

import type { AndroidCollectConfig } from "./androidCollectConfig";
import type { IosCollectConfig } from "./collectorConfig";

export type PublicCollectConfig = {
  enabled: boolean;
  tags: string[];
  android_collect: AndroidCollectConfig;
  ios_collect: IosCollectConfig;
};

export async function fetchPublicCollectStatus(): Promise<PublicCollectStatus> {
  const res = await fetch("/api/v1/public/collect/status");
  return parseApiResponse<PublicCollectStatus>(res);
}

export async function fetchPublicCollectConfig(): Promise<PublicCollectConfig> {
  const res = await fetch("/api/v1/settings/public_collect_config");
  return parseApiResponse<PublicCollectConfig>(res);
}

export async function savePublicCollectConfig(cfg: PublicCollectConfig): Promise<void> {
  const res = await fetch("/api/v1/settings/public_collect_config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cfg),
  });
  await parseApiResponse(res);
}

export async function uploadPublicCollect(params: {
  platform: "android" | "ios";
  source: string;
  user?: string;
  data: Blob;
  /** Per-upload iOS sysdiagnose options (overrides Settings for this job). */
  sysdiagnose?: {
    logarchive_uncapped?: boolean;
    logarchive_decode_max_lines?: number;
    max_entry_mb?: number;
    ioservice_full_tree?: boolean;
  };
}): Promise<PublicCollectIngestResponse> {
  const url = new URL("/api/v1/public/collect/ingest", window.location.origin);
  url.searchParams.set("platform", params.platform);
  url.searchParams.set("source", params.source);
  if (params.user?.trim()) {
    url.searchParams.set("user", params.user.trim());
  }
  if (params.platform === "ios" && params.sysdiagnose) {
    const s = params.sysdiagnose;
    if (s.logarchive_uncapped != null) {
      url.searchParams.set("logarchive_uncapped", String(s.logarchive_uncapped));
    }
    if (s.logarchive_decode_max_lines != null) {
      url.searchParams.set(
        "logarchive_decode_max_lines",
        String(s.logarchive_decode_max_lines)
      );
    }
    if (s.max_entry_mb != null) {
      url.searchParams.set("max_entry_mb", String(s.max_entry_mb));
    }
    if (s.ioservice_full_tree != null) {
      url.searchParams.set("ioservice_full_tree", String(s.ioservice_full_tree));
    }
  }

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: params.data,
  });
  return parseApiResponse<PublicCollectIngestResponse>(res);
}

export async function uploadPublicCollectStore(params: {
  platform: "android" | "ios";
  source: string;
  fileName: string;
  user?: string;
  data: Blob | Uint8Array;
}): Promise<{ id: string; source: string; file_name: string; file_size: number }> {
  const url = new URL("/api/v1/public/collect/store", window.location.origin);
  url.searchParams.set("platform", params.platform);
  url.searchParams.set("source", params.source);
  url.searchParams.set("file_name", params.fileName);
  if (params.user?.trim()) url.searchParams.set("user", params.user.trim());

  const body =
    params.data instanceof Blob ? params.data : new Blob([params.data as BlobPart]);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body,
  });
  return parseApiResponse(res);
}

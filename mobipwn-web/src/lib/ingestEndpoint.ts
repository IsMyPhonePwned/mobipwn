import { apiPost } from "@/lib/api";
import {
  mergeEndpointIngestConfig,
  type EndpointIngestConfig,
} from "@/lib/ironsift";
import { countJsonlLines, formatBytes, type IngestProgress } from "@/lib/ingestProgress";

export async function uploadEndpointJsonl(opts: {
  source: string;
  jsonl: string;
  fileName?: string;
  tags?: string[];
  onProgress?: (progress: IngestProgress) => void;
}): Promise<{ ingested: number }> {
  const lines = countJsonlLines(opts.jsonl);
  const sizeLabel = `${lines} line${lines === 1 ? "" : "s"}`;
  opts.onProgress?.({
    percent: 8,
    phase: "read",
    detail: opts.fileName ? `${opts.fileName} · ${sizeLabel}` : sizeLabel,
  });

  opts.onProgress?.({
    percent: 30,
    phase: "post",
    detail: `platform=endpoint · source=${opts.source.trim()}`,
  });

  const result = await apiPost<{ ingested: number }>("/v1/ingest/jsonl", {
    platform: "endpoint",
    source: opts.source.trim(),
    jsonl: opts.jsonl,
    tags: opts.tags?.length ? opts.tags : undefined,
  });

  opts.onProgress?.({
    percent: 100,
    phase: "processing",
    detail: `${result.ingested} event${result.ingested === 1 ? "" : "s"} indexed in ClickHouse`,
  });

  return result;
}

export type EndpointZipDeviceOptions = {
  parentDirDeviceField?: number | null;
  parentDirDelimiter?: string;
  parentDirTagField?: number | null;
};

export function endpointDeviceRuleQuery(
  endpointIngest: EndpointIngestConfig
): EndpointZipDeviceOptions {
  const cfg = mergeEndpointIngestConfig(endpointIngest);
  const field = cfg.zip_device_rule?.parent_dir_field;
  return {
    parentDirDeviceField: field ?? null,
    parentDirDelimiter: cfg.zip_device_rule?.delimiter,
    parentDirTagField: cfg.zip_parent_tag_field ?? null,
  };
}

export async function uploadEndpointZip(opts: {
  source: string;
  file: File;
  tags?: string[];
  user?: string;
  deviceRule?: EndpointZipDeviceOptions;
  onProgress?: (progress: IngestProgress) => void;
}): Promise<{ ingested: number }> {
  opts.onProgress?.({
    percent: 10,
    phase: "read",
    detail: `${opts.file.name} · ${formatBytes(opts.file.size)}`,
  });
  const params = new URLSearchParams({ source: opts.source.trim() });
  if (opts.user?.trim()) params.set("user", opts.user.trim());
  if (opts.tags?.length) params.set("tags", opts.tags.join(","));
  const field = opts.deviceRule?.parentDirDeviceField;
  if (field != null && field > 0) {
    params.set("parent_dir_device_field", String(field));
    const delim = opts.deviceRule?.parentDirDelimiter?.trim();
    if (delim) params.set("parent_dir_delimiter", delim.slice(0, 1));
  }
  const tagField = opts.deviceRule?.parentDirTagField;
  if (tagField != null && tagField > 0) {
    params.set("parent_dir_tag_field", String(tagField));
  }

  opts.onProgress?.({
    percent: 35,
    phase: "post",
    detail: `platform=endpoint · zip · source=${opts.source.trim()}`,
  });

  const body = await opts.file.arrayBuffer();
  const res = await fetch(`/api/v1/ingest/endpoint-zip?${params.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/zip" },
    body,
  });
  if (!res.ok) throw new Error(await res.text());
  const result = (await res.json()) as { ingested: number };

  opts.onProgress?.({
    percent: 100,
    phase: "processing",
    detail: `${result.ingested} event${result.ingested === 1 ? "" : "s"} indexed from zip`,
  });

  return result;
}

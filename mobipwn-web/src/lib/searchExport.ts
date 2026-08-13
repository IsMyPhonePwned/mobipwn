type ExportOpts = {
  query: string;
  time_from?: string;
  time_to?: string;
  format: "csv" | "jsonl";
  limit?: number;
};

function parseFilename(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback;
  const match = disposition.match(/filename="([^"]+)"/);
  return match?.[1] ?? fallback;
}

export async function downloadSearchExport(opts: ExportOpts): Promise<void> {
  const res = await fetch("/api/v1/search/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Export failed (${res.status})`);
  }
  const blob = await res.blob();
  const ext = opts.format === "csv" ? "csv" : "jsonl";
  const filename = parseFilename(
    res.headers.get("Content-Disposition"),
    `mobipwn-search.${ext}`
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

const SERVICE_FILES: Record<string, string> = {
  api: "api.log",
  jobs: "jobs.log",
  web: "web.log",
};

function tailLines(content: string, maxLines: number): string[] {
  const lines = content.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.slice(-maxLines);
}

/** Dev-only: tail `.dev/*.log` when the API process is stale or MOBIPWN_EXPOSE_DEV_LOGS is off. */
export function mobipwnDevLogsPlugin(devDir: string): Plugin {
  return {
    name: "mobipwn-dev-logs",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__mobipwn/dev/logs", (req, res, next) => {
        if (req.method !== "GET") {
          next();
          return;
        }
        const url = new URL(req.url ?? "/", "http://localhost");
        const service = url.searchParams.get("service") ?? "api";
        const filename = SERVICE_FILES[service];
        if (!filename) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "text/plain");
          res.end("unknown service");
          return;
        }
        const lines = Math.min(
          Math.max(1, Number(url.searchParams.get("lines") ?? "120") || 120),
          500
        );
        const filePath = path.join(devDir, filename);
        let fileLines: string[] = [];
        try {
          if (fs.existsSync(filePath)) {
            fileLines = tailLines(fs.readFileSync(filePath, "utf8"), lines);
          }
        } catch {
          /* empty */
        }
        let enrichmentSync: Record<string, unknown> | null = null;
        try {
          const statusPath = path.join(devDir, "enrichment-sync.json");
          if (fs.existsSync(statusPath)) {
            enrichmentSync = JSON.parse(fs.readFileSync(statusPath, "utf8")) as Record<
              string,
              unknown
            >;
            if (enrichmentSync?.running) {
              const who = (enrichmentSync.source as string) || "enrichment";
              const provider =
                (enrichmentSync.provider_name as string) ||
                (enrichmentSync.provider_slug as string) ||
                "";
              const providerSuffix = provider ? ` — ${provider}` : "";
              const stats = enrichmentSync.stats as Record<string, number> | undefined;
              let statsSuffix = "";
              if (stats?.api_requests) {
                statsSuffix = ` · ${stats.api_requests} API req (${stats.api_ok ?? 0} ok)`;
              } else if (stats?.rows_written) {
                statsSuffix = ` · ${stats.rows_written} row(s)`;
              }
              fileLines.unshift(
                `[enrichment] RUNNING (${who}${providerSuffix}): ${enrichmentSync.message ?? ""}${statsSuffix}`
              );
            }
          }
        } catch {
          /* empty */
        }
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            service,
            path: filePath,
            lines: fileLines,
            enabled: true,
            source: "vite",
            enrichment_sync: enrichmentSync,
          })
        );
      });
    },
  };
}

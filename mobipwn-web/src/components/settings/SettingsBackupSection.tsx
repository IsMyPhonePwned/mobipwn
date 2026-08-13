import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import {
  exportBackup,
  fetchBackupSections,
  importBackup,
  type BackupBundle,
  type BackupSectionInfo,
  type ImportMode,
} from "@/lib/backup";

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function SettingsBackupSection() {
  const { log } = useActivityLog();
  const fileRef = useRef<HTMLInputElement>(null);
  const [sections, setSections] = useState<BackupSectionInfo[]>([]);
  const [exportSelected, setExportSelected] = useState<Set<string>>(new Set());
  const [importSelected, setImportSelected] = useState<Set<string>>(new Set());
  const [bundle, setBundle] = useState<BackupBundle | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>("replace");
  const [busy, setBusy] = useState<"export" | "import" | "">("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    void fetchBackupSections()
      .then((list) => {
        setSections(list);
        setExportSelected(new Set(list.map((s) => s.id)));
      })
      .catch((e) => setErr(String(e)));
  }, []);

  const importableSections = useMemo(() => {
    if (!bundle) return [];
    return bundle.sections_included
      .map((id) => sections.find((s) => s.id === id))
      .filter((s): s is BackupSectionInfo => !!s);
  }, [bundle, sections]);

  useEffect(() => {
    if (importableSections.length > 0) {
      setImportSelected(new Set(importableSections.map((s) => s.id)));
    }
  }, [importableSections]);

  function toggle(setter: Dispatch<SetStateAction<Set<string>>>, id: string) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runExport() {
    const picked = [...exportSelected];
    if (picked.length === 0) {
      setErr("Select at least one section to export.");
      return;
    }
    setBusy("export");
    setErr("");
    setMsg("");
    try {
      log("info", "Backup export", picked.join(", "));
      const json = await exportBackup(picked);
      const filename = `mobipwn-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
      downloadText(filename, json);
      setMsg(`Exported ${picked.length} section(s).`);
    } catch (e) {
      setErr(String(e));
      log("error", "Backup export failed", String(e));
    } finally {
      setBusy("");
    }
  }

  async function onFilePicked(file: File | null) {
    if (!file) return;
    setErr("");
    setMsg("");
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as BackupBundle;
      if (!parsed.format_version || !parsed.data) {
        throw new Error("Invalid mobipwn backup file.");
      }
      setBundle(parsed);
      setMsg(
        `Loaded backup from ${parsed.exported_at} (${parsed.sections_included.length} section(s)).`
      );
    } catch (e) {
      setBundle(null);
      setErr(String(e));
    }
  }

  async function runImport() {
    if (!bundle) {
      setErr("Choose a backup file first.");
      return;
    }
    const picked = [...importSelected];
    if (picked.length === 0) {
      setErr("Select at least one section to import.");
      return;
    }
    if (
      importMode === "replace" &&
      !window.confirm(
        `Replace ${picked.length} section(s) from backup?\n\nExisting data in those sections will be deleted first.`
      )
    ) {
      return;
    }
    setBusy("import");
    setErr("");
    setMsg("");
    try {
      log("info", "Backup import", `${importMode}: ${picked.join(", ")}`);
      const result = await importBackup(bundle, picked, importMode);
      const rows = result.imported_sections
        .map((s) => {
          const total = Object.values(s.tables).reduce((a, b) => a + b, 0);
          return `${s.section}: ${total} rows`;
        })
        .join(" · ");
      setMsg(`Import complete. ${rows}`);
      if (result.warnings.length > 0) {
        setErr(result.warnings.join("\n"));
      }
    } catch (e) {
      setErr(String(e));
      log("error", "Backup import failed", String(e));
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="card settings-panel">
      <h2>Backup &amp; restore</h2>
      <p className="muted settings-panel__subhead">
        Export platform state to JSON and restore selected sections later. Secrets in
        users/API keys and LLM/MCP keys are redacted on export — reconfigure them after
        restore. Ingest archive files and AnoMark model binaries are not included.
        When restoring multiple sections, import rules before alerts; import cases before
        case-linked alerts.
      </p>

      <div className="backup-grid">
        <div className="backup-panel">
          <h3 className="backup-panel__title">
            <Download size={16} aria-hidden />
            Export
          </h3>
          <ul className="backup-section-list">
            {sections.map((sec) => (
              <li key={sec.id}>
                <label className="backup-section-row">
                  <input
                    type="checkbox"
                    checked={exportSelected.has(sec.id)}
                    onChange={() => toggle(setExportSelected, sec.id)}
                  />
                  <span>
                    <span className="backup-section-row__label">{sec.label}</span>
                    <span className="muted text-xs">{sec.description}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="backup-panel__actions">
            <Button
              type="button"
              disabled={busy !== "" || sections.length === 0}
              onClick={() => void runExport()}
            >
              {busy === "export" ? "Exporting…" : "Download backup"}
            </Button>
          </div>
        </div>

        <div className="backup-panel">
          <h3 className="backup-panel__title">
            <Upload size={16} aria-hidden />
            Import
          </h3>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(e) => void onFilePicked(e.target.files?.[0] ?? null)}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={busy !== ""}
            onClick={() => fileRef.current?.click()}
          >
            Choose backup file…
          </Button>

          {bundle && (
            <>
              <p className="muted text-xs backup-meta">
                Format v{bundle.format_version} · exported {bundle.exported_at}
              </p>
              <fieldset className="backup-mode">
                <legend className="text-xs muted">Import mode</legend>
                <label className="backup-mode__option">
                  <input
                    type="radio"
                    name="import-mode"
                    checked={importMode === "replace"}
                    onChange={() => setImportMode("replace")}
                  />
                  Replace — wipe selected sections, then load backup
                </label>
                <label className="backup-mode__option">
                  <input
                    type="radio"
                    name="import-mode"
                    checked={importMode === "merge"}
                    onChange={() => setImportMode("merge")}
                  />
                  Merge — upsert platform settings keys only (config section)
                </label>
              </fieldset>
              <ul className="backup-section-list">
                {importableSections.map((sec) => (
                  <li key={sec.id}>
                    <label className="backup-section-row">
                      <input
                        type="checkbox"
                        checked={importSelected.has(sec.id)}
                        onChange={() => toggle(setImportSelected, sec.id)}
                      />
                      <span>
                        <span className="backup-section-row__label">{sec.label}</span>
                        <span className="muted text-xs">{sec.description}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="backup-panel__actions">
                <Button
                  type="button"
                  disabled={busy !== ""}
                  onClick={() => void runImport()}
                >
                  {busy === "import" ? "Importing…" : "Import selected sections"}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      {msg && <p className="settings-panel__msg">{msg}</p>}
      {err && <p className="settings-panel__msg settings-test-result--err">{err}</p>}
    </section>
  );
}

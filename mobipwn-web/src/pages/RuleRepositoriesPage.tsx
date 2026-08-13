import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Database, ArrowLeft, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/PageHeader";
import { CompactDataTable } from "@/components/ui/CompactDataTable";
import { useLocale } from "@/contexts/LocaleContext";

type Repo = {
  id: string;
  name: string;
  path: string;
  rule_count: number;
  deploy_command: string;
};

type RepoRule = {
  path: string;
  name: string;
  severity?: string;
  lifecycle?: string;
};

export default function RuleRepositoriesPage() {
  const { t } = useLocale();
  const [repos, setRepos] = useState<Repo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [rules, setRules] = useState<RepoRule[]>([]);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/v1/rule-repositories")
      .then((r) => r.json())
      .then((data: { repositories?: Repo[] }) => {
        const list = data.repositories ?? [];
        setRepos(list);
        if (list[0]) setActiveId(list[0].id);
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!activeId) return;
    fetch(`/api/v1/rule-repositories/${activeId}/rules`)
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json() as Promise<RepoRule[]>;
      })
      .then(setRules)
      .catch((e) => setError(String(e)));
  }, [activeId]);

  const active = repos.find((r) => r.id === activeId);

  const copyDeploy = () => {
    if (!active) return;
    void navigator.clipboard.writeText(active.deploy_command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rule-repos-page">
      <PageHeader
        title={t("pages.ruleRepositories")}
        description="GitOps packs deployed with mobipwn-dac"
        meta={
          <Link to="/rules" className="rule-editor-back">
            <ArrowLeft className="icon" />
            {t("nav.rules")}
          </Link>
        }
      />

      {error && <p className="error">{error}</p>}

      <div className="rule-repos-layout">
        <aside className="card rule-repos-sidebar">
          <h3>Packs</h3>
          {repos.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`rule-repos-repo-btn ${activeId === r.id ? "active" : ""}`}
              onClick={() => setActiveId(r.id)}
            >
              <Database className="icon" />
              <span>{r.name}</span>
              <span className="muted">{r.rule_count} rules</span>
            </button>
          ))}
        </aside>

        <div className="rule-repos-main">
          {active && (
            <div className="card rule-repos-deploy">
              <p className="mono">{active.path}</p>
              <div className="rule-repos-deploy-cmd">
                <code className="mono">{active.deploy_command}</code>
                <Button variant="secondary" size="sm" onClick={copyDeploy}>
                  <Copy className="icon" />
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <p className="muted">
                Set <code className="mono">MOBIPWN_QUERIES_PACK</code> to point the API at another directory
                (default: <code className="mono">examples/mobipwn-queries</code>).
              </p>
            </div>
          )}

          <div className="card rule-repos-table-wrap">
            <CompactDataTable>
              <thead>
                <tr>
                  <th>Path</th>
                  <th>Name</th>
                  <th>Severity</th>
                  <th>Lifecycle</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.path}>
                    <td className="mono">{r.path}</td>
                    <td>{r.name}</td>
                    <td>{r.severity ?? "—"}</td>
                    <td>{r.lifecycle ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </CompactDataTable>
            {rules.length === 0 && (
              <p className="muted rule-repos-empty">No YAML rules found in this pack.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

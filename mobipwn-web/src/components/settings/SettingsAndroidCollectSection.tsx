import { useEffect, useState } from "react";
import { Plus, Shield, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { YaraRuleEditor } from "@/components/editor/YaraRuleEditor";
import { useLocale } from "@/contexts/LocaleContext";
import {
  compileYaraSource,
  defaultYaraRule,
  DEFAULT_MAX_HASH_SIZE,
  normalizeConfigCommands,
  type AndroidCollectConfig,
  type AndroidYaraRule,
} from "@/lib/androidCollectConfig";
import { toggleMagpieCommand, type MagpieCommand } from "@/lib/androidCollector";

type Props = {
  value: AndroidCollectConfig;
  onChange: (next: AndroidCollectConfig) => void;
  disabled?: boolean;
  /** When true, omit the outer section header (nested under Collector settings). */
  embedded?: boolean;
  /** `no-yara`: settings tab; `yara-only`: YARA tab; default shows all sections. */
  variant?: "full" | "no-yara" | "yara-only";
};

function PathList({
  paths,
  onChange,
  disabled,
  placeholder,
  allowEmpty = false,
}: {
  paths: string[];
  onChange: (paths: string[]) => void;
  disabled: boolean;
  placeholder: string;
  allowEmpty?: boolean;
}) {
  return (
    <ul className="android-collect__path-list">
      {paths.length === 0 ? (
        <li className="muted text-xs">{placeholder}</li>
      ) : (
        paths.map((path, index) => (
          <li key={index} className="android-collect__path-row">
            <input
              className="mono"
              value={path}
              disabled={disabled}
              placeholder={placeholder}
              onChange={(e) =>
                onChange(paths.map((p, i) => (i === index ? e.target.value : p)))
              }
            />
            <button
              type="button"
              className="android-collect__path-remove"
              disabled={disabled || (!allowEmpty && paths.length <= 1)}
              aria-label={`Remove path ${index + 1}`}
              onClick={() => onChange(paths.filter((_, i) => i !== index))}
            >
              <Trash2 size={14} aria-hidden />
            </button>
          </li>
        ))
      )}
    </ul>
  );
}

export function SettingsAndroidCollectSection({
  value,
  onChange,
  disabled = false,
  embedded = false,
  variant = "full",
}: Props) {
  const { t } = useLocale();
  const showMagpieSettings = variant !== "yara-only";
  const showYaraScanPaths = variant === "full" || variant === "yara-only";
  const showYaraRules = variant === "full" || variant === "yara-only";
  const showPullRepos = variant !== "yara-only";
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [compileBusy, setCompileBusy] = useState(false);
  const [compileMsg, setCompileMsg] = useState("");

  const commands = normalizeConfigCommands(value.default_commands);
  const selectedRule =
    value.yara_rules.find((r) => r.id === selectedRuleId) ?? value.yara_rules[0] ?? null;

  useEffect(() => {
    if (value.yara_rules.length === 0) {
      setSelectedRuleId(null);
      return;
    }
    if (!selectedRuleId || !value.yara_rules.some((r) => r.id === selectedRuleId)) {
      setSelectedRuleId(value.yara_rules[0]!.id);
    }
  }, [value.yara_rules, selectedRuleId]);

  const patch = (partial: Partial<AndroidCollectConfig>) => onChange({ ...value, ...partial });

  const patchRule = (id: string, partial: Partial<AndroidYaraRule>) => {
    patch({
      yara_rules: value.yara_rules.map((rule) =>
        rule.id === id ? { ...rule, ...partial } : rule
      ),
    });
  };

  const addRule = () => {
    const rule = defaultYaraRule(`Rule ${value.yara_rules.length + 1}`);
    patch({ yara_rules: [...value.yara_rules, rule] });
    setSelectedRuleId(rule.id);
  };

  const removeRule = (id: string) => {
    patch({ yara_rules: value.yara_rules.filter((r) => r.id !== id) });
  };

  const testCompileRule = async (rule: AndroidYaraRule) => {
    setCompileBusy(true);
    setCompileMsg("");
    try {
      const resp = await compileYaraSource(rule.source);
      if (resp.ok) {
        patchRule(rule.id, { compile_error: null, compiled_b64: resp.compiled_b64 ?? null });
        setCompileMsg(t("androidCollect.compileOk"));
      } else {
        patchRule(rule.id, { compile_error: resp.error ?? "Compile failed", compiled_b64: null });
        setCompileMsg(resp.error ?? t("androidCollect.compileFailed"));
      }
    } catch (e) {
      setCompileMsg(String(e));
    } finally {
      setCompileBusy(false);
    }
  };

  return (
    <section className={embedded ? "android-collect-settings android-collect-settings--embedded" : "settings-subsection android-collect-settings"}>
      {!embedded && (
        <header className="settings-subsection__header">
          <Shield size={18} aria-hidden />
          <div>
            <h3>{t("androidCollect.title")}</h3>
            <p className="muted text-sm">{t("androidCollect.subtitle")}</p>
          </div>
        </header>
      )}

      {showMagpieSettings && (
      <fieldset className="android-collect__commands" disabled={disabled}>
        <legend className="text-xs muted">{t("androidCollect.commandsLabel")}</legend>
        {(["find", "ps", "yara"] as MagpieCommand[]).map((cmd) => (
          <label key={cmd} className="settings-row settings-row--checkbox">
            <input
              type="checkbox"
              checked={commands.includes(cmd)}
              disabled={disabled}
              onChange={(e) =>
                patch({
                  default_commands: toggleMagpieCommand(commands, cmd, e.target.checked),
                })
              }
            />
            <span>{t(`androidCollect.command.${cmd}` as "androidCollect.command.find")}</span>
          </label>
        ))}
      </fieldset>
      )}

      {showMagpieSettings && (
      <div className="android-collect__grid">
        <div className="android-collect__panel">
          <div className="android-collect__panel-head">
            <span className="settings-field__label">{t("androidCollect.findPathsLabel")}</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={disabled}
              onClick={() => patch({ find_paths: [...value.find_paths, ""] })}
            >
              <Plus size={14} aria-hidden />
              {t("androidCollect.addPath")}
            </button>
          </div>
          <PathList
            paths={value.find_paths}
            onChange={(find_paths) => patch({ find_paths })}
            disabled={disabled}
            placeholder="/sdcard"
          />
          <label className="settings-field">
            <span className="settings-field__label">{t("androidCollect.maxDepthLabel")}</span>
            <input
              type="number"
              min={1}
              max={10}
              disabled={disabled}
              value={value.max_depth}
              onChange={(e) =>
                patch({ max_depth: Math.min(10, Math.max(1, Number(e.target.value) || 3)) })
              }
            />
          </label>

          <div className="android-collect__find-options">
            <span className="settings-field__label">{t("androidCollect.findOptionsLabel")}</span>
            <p className="muted text-xs">{t("androidCollect.findOptionsHint")}</p>
            <label className="settings-row settings-row--checkbox">
              <input
                type="checkbox"
                checked={value.hash_files}
                disabled={disabled}
                onChange={(e) => patch({ hash_files: e.target.checked })}
              />
              <span>{t("androidCollect.hashFilesLabel")}</span>
            </label>
            <p className="muted text-xs">{t("androidCollect.hashFilesHint")}</p>
            <label className="settings-field">
              <span className="settings-field__label">{t("androidCollect.maxHashSizeLabel")}</span>
              <input
                type="number"
                min={1}
                max={65536}
                disabled={disabled || !value.hash_files}
                value={Math.round(value.max_hash_size / 1024)}
                onChange={(e) =>
                  patch({
                    max_hash_size: Math.min(
                      65536,
                      Math.max(1, Number(e.target.value) || DEFAULT_MAX_HASH_SIZE / 1024)
                    ) * 1024,
                  })
                }
              />
              <p className="muted text-xs">{t("androidCollect.maxHashSizeHint")}</p>
            </label>
            <div className="android-collect__panel-head">
              <span className="settings-field__label">{t("androidCollect.excludeDirsLabel")}</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={disabled}
                onClick={() => patch({ exclude_dirs: [...value.exclude_dirs, ""] })}
              >
                <Plus size={14} aria-hidden />
                {t("androidCollect.addExcludeDir")}
              </button>
            </div>
            <p className="muted text-xs">{t("androidCollect.excludeDirsHint")}</p>
            <PathList
              paths={value.exclude_dirs}
              onChange={(exclude_dirs) => patch({ exclude_dirs })}
              disabled={disabled}
              allowEmpty
              placeholder="**/MyApp/cache"
            />
          </div>
        </div>

        {showYaraScanPaths && variant === "full" && (
        <div className="android-collect__panel">
          <div className="android-collect__panel-head">
            <span className="settings-field__label">{t("androidCollect.yaraPathsLabel")}</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={disabled}
              onClick={() => patch({ yara_paths: [...value.yara_paths, ""] })}
            >
              <Plus size={14} aria-hidden />
              {t("androidCollect.addPath")}
            </button>
          </div>
          <PathList
            paths={value.yara_paths}
            onChange={(yara_paths) => patch({ yara_paths })}
            disabled={disabled}
            placeholder="/sdcard"
          />
          <label className="settings-field">
            <span className="settings-field__label">{t("androidCollect.yaraMaxDepthLabel")}</span>
            <input
              type="number"
              min={1}
              max={10}
              disabled={disabled}
              value={value.yara_max_depth}
              onChange={(e) =>
                patch({
                  yara_max_depth: Math.min(10, Math.max(1, Number(e.target.value) || 3)),
                })
              }
            />
          </label>
        </div>
        )}
      </div>
      )}

      {showYaraScanPaths && variant === "yara-only" && (
        <div className="android-collect__panel">
          <div className="android-collect__panel-head">
            <span className="settings-field__label">{t("androidCollect.yaraPathsLabel")}</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={disabled}
              onClick={() => patch({ yara_paths: [...value.yara_paths, ""] })}
            >
              <Plus size={14} aria-hidden />
              {t("androidCollect.addPath")}
            </button>
          </div>
          <PathList
            paths={value.yara_paths}
            onChange={(yara_paths) => patch({ yara_paths })}
            disabled={disabled}
            placeholder="/sdcard"
          />
          <label className="settings-field">
            <span className="settings-field__label">{t("androidCollect.yaraMaxDepthLabel")}</span>
            <input
              type="number"
              min={1}
              max={10}
              disabled={disabled}
              value={value.yara_max_depth}
              onChange={(e) =>
                patch({
                  yara_max_depth: Math.min(10, Math.max(1, Number(e.target.value) || 3)),
                })
              }
            />
          </label>
        </div>
      )}

      {showPullRepos && (
        <div className="android-collect__panel android-collect__pull-repos">
          <div className="android-collect__panel-head">
            <span className="settings-field__label">{t("androidCollect.pullReposLabel")}</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={disabled}
              onClick={() => patch({ pull_repository_paths: [...value.pull_repository_paths, ""] })}
            >
              <Plus size={14} aria-hidden />
              {t("androidCollect.addPath")}
            </button>
          </div>
          <p className="muted text-xs">{t("androidCollect.pullReposHint")}</p>
          <PathList
            paths={value.pull_repository_paths}
            onChange={(pull_repository_paths) => patch({ pull_repository_paths })}
            disabled={disabled}
            allowEmpty
            placeholder="/data/app"
          />
          <div className="android-collect__pull-limits">
            <label className="settings-field">
              <span className="settings-field__label">{t("androidCollect.pullMaxDepthLabel")}</span>
              <input
                type="number"
                min={1}
                max={10}
                disabled={disabled}
                value={value.pull_max_depth}
                onChange={(e) =>
                  patch({
                    pull_max_depth: Math.min(10, Math.max(1, Number(e.target.value) || 5)),
                  })
                }
              />
            </label>
            <label className="settings-field">
              <span className="settings-field__label">{t("androidCollect.pullMaxFileSizeLabel")}</span>
              <input
                type="number"
                min={1}
                max={512}
                disabled={disabled}
                value={Math.round(value.pull_max_file_size / (1024 * 1024))}
                onChange={(e) =>
                  patch({
                    pull_max_file_size:
                      Math.min(512, Math.max(1, Number(e.target.value) || 50)) * 1024 * 1024,
                  })
                }
              />
              <p className="muted text-xs">{t("androidCollect.pullMaxFileSizeHint")}</p>
            </label>
            <label className="settings-field">
              <span className="settings-field__label">{t("androidCollect.pullMaxFilesLabel")}</span>
              <input
                type="number"
                min={1}
                max={10000}
                disabled={disabled}
                value={value.pull_max_files}
                onChange={(e) =>
                  patch({
                    pull_max_files: Math.min(10_000, Math.max(1, Number(e.target.value) || 500)),
                  })
                }
              />
            </label>
          </div>
        </div>
      )}

      {showYaraRules && (
      <div className="android-collect__yara">
        <div className="android-collect__yara-head">
          <div>
            <span className="settings-field__label">{t("androidCollect.yaraRulesLabel")}</span>
            <p className="muted text-xs">{t("androidCollect.yaraRulesHint")}</p>
          </div>
          <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={addRule}>
            <Plus size={14} aria-hidden />
            {t("androidCollect.addRule")}
          </Button>
        </div>

        {value.yara_bundle_error && (
          <p className="error text-xs">
            {t("androidCollect.bundleError")}: {value.yara_bundle_error}
          </p>
        )}
        {value.yara_bundle_b64 && !value.yara_bundle_error && (
          <p className="muted text-xs">{t("androidCollect.bundleReady")}</p>
        )}

        {value.yara_rules.length === 0 ? (
          <p className="muted text-sm">{t("androidCollect.noRules")}</p>
        ) : (
          <div className="android-collect__yara-layout">
            <ul className="android-collect__rule-list">
              {value.yara_rules.map((rule) => (
                <li key={rule.id}>
                  <button
                    type="button"
                    className={`android-collect__rule-item${selectedRule?.id === rule.id ? " android-collect__rule-item--active" : ""}`}
                    disabled={disabled}
                    onClick={() => setSelectedRuleId(rule.id)}
                  >
                    <span className="android-collect__rule-name">{rule.name}</span>
                    {rule.compile_error ? (
                      <span className="android-collect__rule-badge android-collect__rule-badge--error">
                        {t("androidCollect.ruleError")}
                      </span>
                    ) : rule.compiled_b64 ? (
                      <span className="android-collect__rule-badge">{t("androidCollect.ruleOk")}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>

            {selectedRule && (
              <div className="android-collect__rule-editor card">
                <div className="android-collect__rule-toolbar">
                  <label className="settings-field android-collect__rule-name-field">
                    <span className="text-xs muted">{t("androidCollect.ruleNameLabel")}</span>
                    <input
                      value={selectedRule.name}
                      disabled={disabled}
                      onChange={(e) => patchRule(selectedRule.id, { name: e.target.value })}
                    />
                  </label>
                  <label className="settings-row settings-row--checkbox">
                    <input
                      type="checkbox"
                      checked={selectedRule.enabled}
                      disabled={disabled}
                      onChange={(e) => patchRule(selectedRule.id, { enabled: e.target.checked })}
                    />
                    <span>{t("androidCollect.ruleEnabled")}</span>
                  </label>
                  <div className="android-collect__rule-actions">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={disabled || compileBusy}
                      onClick={() => void testCompileRule(selectedRule)}
                    >
                      {compileBusy ? t("androidCollect.compiling") : t("androidCollect.testCompile")}
                    </Button>
                    <button
                      type="button"
                      className="android-collect__path-remove"
                      disabled={disabled}
                      aria-label={t("androidCollect.deleteRule")}
                      onClick={() => removeRule(selectedRule.id)}
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  </div>
                </div>
                {selectedRule.compile_error && (
                  <pre className="android-collect__compile-error mono text-xs">
                    {selectedRule.compile_error}
                  </pre>
                )}
                <YaraRuleEditor
                  value={selectedRule.source}
                  disabled={disabled}
                  onChange={(source) => patchRule(selectedRule.id, { source, compile_error: null })}
                />
              </div>
            )}
          </div>
        )}
        {compileMsg && <p className="text-sm settings-msg">{compileMsg}</p>}
      </div>
      )}
    </section>
  );
}

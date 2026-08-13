import { useMemo, useState } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import {
  resolveIpAddress,
  splitIpInputs,
  type IpResolveKind,
  type IpResolveResult,
} from "@/lib/ipResolve";

const KIND_LABEL: Record<IpResolveKind, string> = {
  ipv4: "IPv4",
  nat64: "NAT64",
  ipv4_mapped: "IPv4-mapped",
  ipv6: "IPv6",
  invalid: "Invalid",
};

export function MarketplaceIpResolver() {
  const { t } = useLocale();
  const [input, setInput] = useState("");

  const results = useMemo(() => {
    const items = splitIpInputs(input);
    if (items.length === 0) return [];
    return items.map((item) => resolveIpAddress(item));
  }, [input]);

  return (
    <section className="card marketplace-ip-resolver">
      <header className="marketplace-ip-resolver__header">
        <div>
          <h2 className="marketplace-ip-resolver__title">{t("marketplace.ipResolverTitle")}</h2>
          <p className="muted marketplace-ip-resolver__lead">{t("marketplace.ipResolverLead")}</p>
        </div>
      </header>
      <label className="marketplace-ip-resolver__label" htmlFor="marketplace-ip-resolver-input">
        {t("marketplace.ipResolverInputLabel")}
      </label>
      <textarea
        id="marketplace-ip-resolver-input"
        className="marketplace-ip-resolver__input"
        rows={3}
        spellCheck={false}
        placeholder={t("marketplace.ipResolverPlaceholder")}
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />
      {results.length > 0 && (
        <div className="marketplace-ip-resolver__table-wrap">
          <table className="marketplace-ip-resolver__table">
            <thead>
              <tr>
                <th>{t("marketplace.ipResolverColInput")}</th>
                <th>{t("marketplace.ipResolverColKind")}</th>
                <th>{t("marketplace.ipResolverColResolved")}</th>
                <th>{t("marketplace.ipResolverColEnrich")}</th>
              </tr>
            </thead>
            <tbody>
              {results.map((row) => (
                <IpResolverRow key={row.input} row={row} t={t} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function IpResolverRow({
  row,
  t,
}: {
  row: IpResolveResult;
  t: (key: string) => string;
}) {
  const kindLabel = KIND_LABEL[row.kind];
  return (
    <tr className={row.enrichable ? "marketplace-ip-resolver__row--ok" : undefined}>
      <td>
        <code className="marketplace-ip-resolver__mono">{row.input}</code>
      </td>
      <td>
        <span className={`marketplace-ip-resolver__kind marketplace-ip-resolver__kind--${row.kind}`}>
          {kindLabel}
        </span>
        {row.note && <div className="muted marketplace-ip-resolver__note">{row.note}</div>}
      </td>
      <td>
        {row.resolved ? (
          <code className="marketplace-ip-resolver__mono">{row.resolved}</code>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      <td>
        {row.enrichable ? (
          <span className="marketplace-ip-resolver__badge marketplace-ip-resolver__badge--yes">
            {t("marketplace.ipResolverEnrichYes")}
          </span>
        ) : (
          <span className="marketplace-ip-resolver__badge marketplace-ip-resolver__badge--no">
            {t("marketplace.ipResolverEnrichNo")}
          </span>
        )}
      </td>
    </tr>
  );
}

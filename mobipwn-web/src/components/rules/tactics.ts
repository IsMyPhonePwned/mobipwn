/** MITRE tactic filter chips — match rules by technique id prefix in `mitre` tags. */

export const TACTIC_CHIPS = [
  "All tactics",
  "Initial Access",
  "Execution",
  "Persistence",
  "Privilege Escalation",
  "Defense Evasion",
  "Credential Access",
  "Discovery",
  "Lateral Movement",
  "Collection",
  "Command and Control",
  "Exfiltration",
  "Impact",
] as const;

const TACTIC_PREFIXES: Record<string, string[]> = {
  "Initial Access": ["T1566", "T1189", "T1190", "T1133"],
  Execution: ["T1059", "T1203", "T1204", "T1053"],
  Persistence: ["T1547", "T1053", "T1543", "T1078"],
  "Privilege Escalation": ["T1068", "T1548", "T1134", "T1055"],
  "Defense Evasion": ["T1070", "T1027", "T1562", "T1036"],
  "Credential Access": ["T1003", "T1110", "T1555", "T1552"],
  Discovery: ["T1082", "T1016", "T1046", "T1083"],
  "Lateral Movement": ["T1021", "T1210", "T1570"],
  Collection: ["T1119", "T1113", "T1005", "T1074"],
  "Command and Control": ["T1071", "T1095", "T1573", "T1105"],
  Exfiltration: ["T1041", "T1048", "T1567"],
  Impact: ["T1486", "T1499", "T1490", "T1565"],
};

export function ruleMatchesTactic(mitre: string[] | undefined, tactic: string): boolean {
  if (tactic === "All tactics") return true;
  const prefixes = TACTIC_PREFIXES[tactic];
  if (!prefixes?.length) return true;
  const tags = mitre ?? [];
  return tags.some((tag) => {
    const t = tag.toUpperCase();
    return prefixes.some((p) => t.startsWith(p));
  });
}

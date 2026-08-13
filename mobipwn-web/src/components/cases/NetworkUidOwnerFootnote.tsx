/** Secondary line / analyst note for netstat rows that only expose a Linux UID. */
export function NetworkUidOwnerFootnote({
  explanation,
  secondary,
  isUid,
  className = "network-uid-footnote",
}: {
  explanation?: string | null;
  secondary?: string | null;
  isUid?: boolean;
  className?: string;
}) {
  if (explanation) {
    return (
      <div className={`${className} ${className}--explanation muted text-xs`} title={explanation}>
        {explanation}
      </div>
    );
  }
  if (secondary) {
    return (
      <div className={`${className} ${className}--secondary mono text-xs`} title={secondary}>
        {secondary}
      </div>
    );
  }
  if (isUid) {
    return (
      <div className={`${className} ${className}--missing muted text-xs`}>
        UID only — no package match in case
      </div>
    );
  }
  return null;
}

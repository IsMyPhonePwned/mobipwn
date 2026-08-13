import type { ReactNode } from "react";

export function SectionHeader({
  label,
  meta,
  children,
}: {
  label: string;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="section-hdr">
      <span>{label}</span>
      {meta != null && <span className="section-hdr-meta">{meta}</span>}
      {children}
    </div>
  );
}

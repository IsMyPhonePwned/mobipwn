import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & {
  size?: number;
};

/** Classic Apple logo mark (filled). */
export function AppleIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      {...props}
    >
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );
}

/** Android robot mark (filled) — head, antennas, body silhouette. */
export function AndroidIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      {...props}
    >
      <path d="M17.6 9.48 19.44 6.3a.64.64 0 0 0-.26-.85.63.63 0 0 0-.83.22l-1.88 3.24a11.43 11.43 0 0 0-8.94 0L5.65 5.67a.63.63 0 0 0-.83-.22.64.64 0 0 0-.26.85l1.84 3.18C4.23 11.13 3 13.54 3 16.2v.3c0 .83.67 1.5 1.5 1.5h1.1v2.25a1.75 1.75 0 0 0 3.5 0V18h5.8v2.25a1.75 1.75 0 0 0 3.5 0V18h1.1c.83 0 1.5-.67 1.5-1.5v-.3c0-2.66-1.23-5.07-3.4-6.72ZM7 13.5a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm10 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Z" />
    </svg>
  );
}

export type CasePlatformIconKind = "android" | "ios" | "endpoint" | string | null | undefined;

/** Platform glyph for case lists / headers — Android robot, Apple mark, else fallback. */
export function CasePlatformIcon({
  platform,
  size = 16,
  fallback = null,
}: {
  platform: CasePlatformIconKind;
  size?: number;
  fallback?: ReactNode;
}) {
  if (platform === "ios") return <AppleIcon size={size} />;
  if (platform === "android") return <AndroidIcon size={size} />;
  return <>{fallback}</>;
}

/** Release shown in the sidebar / login. Docker `--tag` is baked in as VITE_APP_VERSION. */
export function appVersion(): string {
  const fromEnv = import.meta.env.VITE_APP_VERSION;
  if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv.trim();
  return "dev";
}

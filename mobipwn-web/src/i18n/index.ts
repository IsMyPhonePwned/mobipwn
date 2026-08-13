import { en, type Messages } from "./locales/en";
import { fr } from "./locales/fr";
import { zh } from "./locales/zh";

export type Locale = "en" | "fr" | "zh";

export type TranslationKey = {
  [K in keyof Messages]: `${K & string}.${keyof Messages[K] & string}`;
}[keyof Messages];

const catalogs: Record<Locale, Messages> = { en, fr, zh };

export const LOCALE_STORAGE_KEY = "mobipwn-locale";

export function getStoredLocale(): Locale {
  try {
    const v = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (v === "fr" || v === "zh" || v === "en") return v;
  } catch {
    /* ignore */
  }
  return "en";
}

export function applyLocale(locale: Locale): void {
  const lang = locale === "zh" ? "zh-Hans" : locale;
  document.documentElement.lang = lang;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
}

function lookup(messages: Messages, key: string): string | undefined {
  const parts = key.split(".");
  let cur: unknown = messages;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object" || !(p in cur)) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === "string" ? cur : undefined;
}

export function translate(
  locale: Locale,
  key: string,
  vars?: Record<string, string | number>
): string {
  let text = lookup(catalogs[locale], key) ?? lookup(catalogs.en, key) ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{{${k}}}`, String(v));
    }
  }
  return text;
}

"use client";

import * as React from "react";

import { getClientCookie, setClientCookie } from "@/lib/cookie.client";
import { getLocalStorageValue, setLocalStorageValue } from "@/lib/local-storage.client";

import enUS from "./locales/en-us";
import enUSGenerated from "./locales/en-us.generated.json";
import zhCN from "./locales/zh-cn";

export const LOCALES = ["zh-CN", "en-US"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "zh-CN";
export const LOCALE_STORAGE_KEY = "artex_locale";
export const LOCALE_COOKIE_KEY = "artex_locale";

function normalizeKey(key: string): string {
  return key.replace(/\s+/g, " ").trim();
}

function normalizeCatalog(catalog: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(catalog)) {
    normalized[normalizeKey(key)] = value;
  }
  return normalized;
}

const catalogs: Record<Locale, Record<string, string>> = {
  "zh-CN": normalizeCatalog(zhCN),
  "en-US": normalizeCatalog({ ...(enUSGenerated as Record<string, string>), ...enUS }),
};

export type TranslateParams = Record<string, string | number | undefined>;
export type Translate = (key: string, params?: TranslateParams) => string;

function isLocale(value: string | null | undefined): value is Locale {
  return value === "zh-CN" || value === "en-US";
}

function interpolate(message: string, params?: TranslateParams): string {
  if (!params) return message;
  return message.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = params[name];
    return value === undefined ? placeholder : String(value);
  });
}

/**
 * Translate a source message.
 *
 * Catalogs use gettext-style source messages as keys. If a key is missing in
 * the current locale, the key itself is returned, which makes Chinese source
 * strings safe to use without duplicating them in the `zh-CN` catalog.
 */
export function translate(locale: Locale, key: string, params?: TranslateParams): string {
  const message = catalogs[locale][normalizeKey(key)] ?? key;
  return interpolate(message, params);
}

export interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
}

const I18nContext = React.createContext<I18nContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => undefined,
  t: (key, params) => translate(DEFAULT_LOCALE, key, params),
});

export function I18nProvider({
  children,
  initialLocale = DEFAULT_LOCALE,
}: {
  readonly children: React.ReactNode;
  readonly initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = React.useState<Locale>(initialLocale);
  const hydrated = React.useRef(false);

  // Restore the persisted locale after hydration. The initial render always
  // uses `initialLocale` (zh-CN by default) so SSR and hydration match.
  React.useEffect(() => {
    const saved = getLocalStorageValue(LOCALE_STORAGE_KEY) ?? getClientCookie(LOCALE_COOKIE_KEY);
    if (isLocale(saved)) {
      setLocaleState(saved);
    }
    hydrated.current = true;
  }, []);

  const setLocale = React.useCallback((next: Locale) => {
    setLocaleState(next);
  }, []);

  // Persist and apply the locale after the user switches (and after the
  // hydration restore above).
  React.useEffect(() => {
    if (!hydrated.current) return;
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
    setLocalStorageValue(LOCALE_STORAGE_KEY, locale);
    setClientCookie(LOCALE_COOKIE_KEY, locale, 365);
  }, [locale]);

  const t = React.useCallback<Translate>((key, params) => translate(locale, key, params), [locale]);

  const value = React.useMemo<I18nContextValue>(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return React.useContext(I18nContext);
}

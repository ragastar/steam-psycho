import { locales, defaultLocale, type Locale } from "@/i18n/request";

/** Строка — один из поддерживаемых языков? Иначе null. */
export function normalizeLocale(value: string | null | undefined): Locale | null {
  if (!value) return null;
  return (locales as readonly string[]).includes(value) ? (value as Locale) : null;
}

/**
 * Язык для внешнего входа (Steam), где вернуть человека надо туда же,
 * откуда он ушёл.
 *
 * Маршруты /api/* проходят мимо middleware next-intl, поэтому языка в пути
 * у них нет и спросить его не у кого — приходится собирать самим:
 * явный параметр (если панель входа его передала) → префикс страницы, с
 * которой ушли (Referer) → Accept-Language браузера → русский.
 */
export function localeFromRequest(req: Request): Locale {
  const explicit = normalizeLocale(new URL(req.url).searchParams.get("locale"));
  if (explicit) return explicit;

  const referer = req.headers.get("referer");
  if (referer) {
    try {
      const fromPath = normalizeLocale(new URL(referer).pathname.split("/")[1]);
      if (fromPath) return fromPath;
    } catch {
      // Мусорный Referer — не повод падать, просто идём дальше.
    }
  }

  for (const part of (req.headers.get("accept-language") || "").split(",")) {
    const fromHeader = normalizeLocale(part.split(";")[0].trim().slice(0, 2).toLowerCase());
    if (fromHeader) return fromHeader;
  }

  return defaultLocale;
}

"use client";

import { useLocale } from "next-intl";
import { useRouter, usePathname } from "@/i18n/routing";

export function LocaleSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const switchLocale = (newLocale: "ru" | "en") => {
    router.replace(pathname, { locale: newLocale });
  };

  return (
    <div className="flex gap-1 text-sm">
      <button
        onClick={() => switchLocale("ru")}
        className={`px-2 py-1 rounded transition-colors ${
          locale === "ru"
            ? "bg-purple-600 text-white"
            : "text-gray-400 hover:text-white"
        }`}
      >
        RU
      </button>
      <button
        onClick={() => switchLocale("en")}
        className={`px-2 py-1 rounded transition-colors ${
          locale === "en"
            ? "bg-purple-600 text-white"
            : "text-gray-400 hover:text-white"
        }`}
      >
        EN
      </button>
    </div>
  );
}

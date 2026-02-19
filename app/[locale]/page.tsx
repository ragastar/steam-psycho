import { useTranslations } from "next-intl";
import { SteamInput } from "@/components/SteamInput";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";

export default function Home() {
  const t = useTranslations();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="absolute top-4 right-4">
        <LocaleSwitcher />
      </div>

      <main className="w-full max-w-xl text-center space-y-8">
        <div className="space-y-3">
          <h1 className="text-5xl sm:text-6xl font-bold bg-gradient-to-r from-purple-400 via-pink-500 to-red-500 bg-clip-text text-transparent">
            {t("landing.title")}
          </h1>
          <p className="text-lg text-gray-400">
            {t("landing.tagline")}
          </p>
        </div>

        <p className="text-gray-300">
          {t("landing.subtitle")}
        </p>

        <SteamInput />

        <p className="text-xs text-gray-600">
          {t("landing.disclaimer")}
        </p>
      </main>

      <footer className="absolute bottom-4 text-center text-xs text-gray-700 px-4">
        {t("footer.disclaimer")}
      </footer>
    </div>
  );
}

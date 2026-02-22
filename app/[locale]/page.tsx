import { useTranslations } from "next-intl";
import { SteamInput } from "@/components/SteamInput";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";

export default function Home() {
  const t = useTranslations();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 relative overflow-hidden">
      {/* Background glow effects */}
      <div className="absolute top-1/4 -left-32 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-cyan-600/10 rounded-full blur-3xl" />

      <div className="absolute top-4 right-4 z-10">
        <LocaleSwitcher />
      </div>

      <main className="w-full max-w-lg text-center space-y-10 relative z-10">
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-xs font-medium tracking-wide uppercase">
            Steam AI Analysis
            <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 text-[10px] font-mono">beta v0.1</span>
          </div>

          <h1 className="text-6xl sm:text-7xl font-extrabold tracking-tight">
            <span className="bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-500 bg-clip-text text-transparent">
              {t("landing.title")}
            </span>
          </h1>

          <p className="text-xl text-gray-300 font-medium">
            {t("landing.tagline")}
          </p>

          <p className="text-sm text-gray-500 max-w-md mx-auto">
            {t("landing.subtitle")}
          </p>
        </div>

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

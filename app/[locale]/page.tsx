import { useTranslations } from "next-intl";
import { SteamInput } from "@/components/SteamInput";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { Logo } from "@/components/Logo";

export default function Home() {
  const t = useTranslations();

  return (
    /*
     * Раскладка колонкой, а не «всё по центру плюс подвал внахлёст».
     *
     * Раньше подвал был прибит `absolute bottom-4`: на невысоких экранах он
     * налезал на форму ввода, а на очень низких перекрывал кнопку. Теперь
     * середина растягивается (flex-1), подвал идёт следом обычным потоком и
     * налезть не может в принципе.
     *
     * relative + overflow-x-hidden работают только в паре. Пятна фона вынесены
     * за край экрана намеренно, и обрезать их должен этот блок — но пока он не
     * relative, точкой отсчёта для них остаётся вся страница, обрезка не
     * применяется, и внизу появляется горизонтальная полоса прокрутки.
     * Замерено на живом сайте: страница была шире экрана на 128 пикселей.
     */
    <div className="relative min-h-screen flex flex-col overflow-x-hidden">
      {/* Размытые пятна фона. pointer-events-none, иначе они перехватывают
          нажатия по форме на мобильных. */}
      <div className="pointer-events-none absolute top-1/4 -left-32 w-72 h-72 sm:w-96 sm:h-96 bg-purple-600/10 rounded-full blur-3xl" />
      <div className="pointer-events-none absolute bottom-1/4 -right-32 w-72 h-72 sm:w-96 sm:h-96 bg-cyan-600/10 rounded-full blur-3xl" />

      <header className="relative z-20 flex justify-end p-4">
        <LocaleSwitcher />
      </header>

      <main className="relative z-10 flex-1 flex flex-col items-center justify-center w-full px-4 pb-10">
        <div className="w-full max-w-lg text-center space-y-8 sm:space-y-10">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-[11px] sm:text-xs font-medium tracking-wide uppercase">
              {t("landing.badge")}
            </div>

            <div className="flex flex-col items-center gap-3">
              <Logo className="w-12 h-12 sm:w-14 sm:h-14" />

              {/*
               * Размер заголовка растёт со шириной экрана. Прежний жёсткий
               * text-6xl был рассчитан на короткое латинское имя; с русским
               * названием он вылезал за край телефона.
               *
               * break-words — страховка на случай узких экранов вроде 320px:
               * пусть лучше перенесётся, чем распорет вёрстку.
               */}
              <h1 className="text-[2.6rem] leading-none sm:text-6xl md:text-7xl font-extrabold tracking-tight break-words">
                <span className="bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-500 bg-clip-text text-transparent">
                  {t("landing.title")}
                </span>
              </h1>
            </div>

            <p className="text-lg sm:text-xl text-gray-300 font-medium text-balance">
              {t("landing.tagline")}
            </p>

            <p className="text-sm text-gray-500 max-w-md mx-auto text-balance">
              {t("landing.subtitle")}
            </p>
          </div>

          <SteamInput />

          <p className="text-xs text-gray-600">{t("landing.disclaimer")}</p>
        </div>
      </main>

      <footer className="relative z-10 text-center text-xs text-gray-700 px-4 pb-6 space-y-2">
        <p>
          <a
            href="https://t.me/theragastar"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20 text-purple-400 hover:text-purple-300 hover:border-purple-400/40 transition-all text-xs font-medium"
          >
            разработано по приколу
            <span className="font-semibold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
              @theragastar
            </span>
          </a>
        </p>
        <p className="max-w-2xl mx-auto text-balance">{t("footer.disclaimer")}</p>
      </footer>
    </div>
  );
}

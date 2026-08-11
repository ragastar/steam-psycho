"use client";

import { useState, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { LoadingAnimation } from "./LoadingAnimation";
import { ErrorDisplay } from "./ErrorDisplay";

/**
 * Выбор поставщика и подпись «работает на такой-то модели» с витрины убраны.
 *
 * Во-первых, они ничего не делали: /api/generate поставщика от браузера не
 * принимает — переключатель был декорацией. Во-вторых, они рассказывали
 * посетителю устройство системы: каким сервисом считается текст и какая модель
 * настроена. Вместе с ними удалён /api/providers, отдававший этот список кому
 * угодно без авторизации.
 */
export function SteamInput() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [input, setInput] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const [errorCode, setErrorCode] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) {
      setErrorCode("INVALID_INPUT");
      return;
    }

    setErrorCode("");
    setLoading(true);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120_000);

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Поставщика браузер не выбирает: это решает сервер настройкой
        // LLM_PROVIDER. Раньше поле отправлялось, но /api/analyze его не читал.
        body: JSON.stringify({ input: trimmed, locale }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await res.json();

      if (!res.ok) {
        setErrorCode(data.code || "ANALYSIS_ERROR");
        setLoading(false);
        return;
      }

      router.push(`/${locale}/result/${data.steamId64}`);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setErrorCode("TIMEOUT");
      } else {
        setErrorCode("ANALYSIS_ERROR");
      }
      setLoading(false);
    }
  }, [input, locale, router]);

  const handleRetry = useCallback(() => {
    setErrorCode("");
    handleSubmit();
  }, [handleSubmit]);

  if (loading) {
    return <LoadingAnimation />;
  }

  return (
    <form onSubmit={handleSubmit} className="w-full space-y-4">
      {/*
        На телефоне поле и кнопка идут друг под другом, а не в строку.
        Замерено на ширине 390: в строку кнопка не влезала и уезжала за край
        экрана на 26 пикселей — половина надписи была не видна и нажать её
        было нельзя. С 640 пикселей места хватает, там возвращаем строку.

        min-w-0 на поле обязателен: без него поле отказывается сжиматься
        (у полей ввода своя ширина по умолчанию) и снова выдавливает кнопку.

        inputMode/autoComplete — чтобы телефон не подсовывал автозамену и
        заглавную букву в начале ссылки на профиль.
      */}
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("landing.inputPlaceholder")}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="min-w-0 flex-1 px-4 py-3 bg-gray-900/80 border border-gray-700/50 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-colors"
        />
        <button
          type="submit"
          className="w-full sm:w-auto px-6 py-3 bg-gradient-to-r from-purple-600 to-cyan-600 text-white font-semibold rounded-xl hover:from-purple-500 hover:to-cyan-500 transition-all whitespace-nowrap shadow-lg shadow-purple-600/20"
        >
          {t("landing.submitButton")}
        </button>
      </div>

      <div className="text-center">
        {/*
          py-2 не для красоты: без него у ссылки высота 16 пикселей, и на
          телефоне в неё попадают через раз. Отступы увеличивают область
          нажатия, не меняя вид.
        */}
        <button
          type="button"
          onClick={() => setShowHelp(!showHelp)}
          className="inline-block px-3 py-2 text-xs text-gray-500 hover:text-gray-300 transition-colors underline underline-offset-2"
        >
          {t("landing.helpToggle")}
        </button>
        {showHelp && (
          <div className="mt-2 text-xs text-gray-500 space-y-1 text-left bg-gray-900/50 border border-gray-700/30 rounded-lg px-4 py-3">
            <p>1. {t("landing.helpStep1")}</p>
            <p>2. {t("landing.helpStep2")}</p>
            <p>3. {t("landing.helpStep3")}</p>
            <p className="pt-1 font-mono text-gray-400">{t("landing.helpExample")}</p>
          </div>
        )}
      </div>

      {errorCode && (
        <ErrorDisplay code={errorCode} onRetry={handleRetry} />
      )}
    </form>
  );
}

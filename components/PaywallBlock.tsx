"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { priceInRubles } from "@/lib/billing/price";
import { LoginPanel } from "./LoginPanel";

/**
 * Чем кончился вход через Steam. `ok` сюда не доезжает намеренно: вход
 * состоялся, говорить не о чем, и разворачивать панель входа заново незачем.
 */
export type LoginOutcome = "taken" | "failed";

interface PaywallBlockProps {
  steamId64: string;
  locale: string;
  /**
   * Исход входа через Steam, прочитанный на сервере из `?login=`.
   *
   * Читает страница, а не этот компонент: своим эффектом он ловил бы адрес
   * после первой отрисовки (лишний проход и жалоба react-hooks), а
   * `useSearchParams` требует Suspense-обёртки при статическом пререндере —
   * поломку такого рода `npm run verify` не ловит, она нашлась бы на выкате.
   */
  loginOutcome?: LoginOutcome | null;
  /**
   * Сколько роастов закрыто. Схема допускает 5–6 роастов на карточку, один из
   * них уходит в бесплатную часть — значит закрытых бывает и четыре. Продающая
   * строка обязана называть настоящее число: это обещание товара, а не украшение.
   */
  lockedCount: number;
}

/** Отказы кассы, у каждого свой текст: «попробуй ещё раз» на выключенной кассе — вредный совет. */
type Refusal = "" | "alreadyOwned" | "failed" | "unavailable" | "expired";

/**
 * Список повторяет платную часть карточки один в один. Иконки те же, что на
 * витрине ожидания (TeaserPage), чтобы обещание до генерации и обещание после
 * неё выглядели одним и тем же товаром.
 */
const INCLUDES = [
  { icon: "🔥", key: "roasts" },
  { icon: "🧠", key: "psycho" },
  { icon: "🎭", key: "shadow" },
  { icon: "🦊", key: "spirit" },
  { icon: "🎨", key: "art" },
  { icon: "📊", key: "analytics" },
] as const;

export function PaywallBlock({ steamId64, locale, lockedCount, loginOutcome = null }: PaywallBlockProps) {
  const t = useTranslations();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [needLogin, setNeedLogin] = useState(false);
  const [refusal, setRefusal] = useState<Refusal>("");
  /**
   * Отказ входа показывается ровно до следующего удачного входа. Вход через
   * Steam уводит браузер целиком и возвращает сюда с `?login=taken|failed`:
   * без единого слова на экране человек жмёт «купить» снова, получает 401,
   * снова панель входа — и так по кругу без выхода.
   */
  const [loginDismissed, setLoginDismissed] = useState(false);
  const showLoginOutcome = loginOutcome && !loginDismissed ? loginOutcome : null;

  useEffect(() => {
    // Возврат «Назад» с кассы. Уход на payUrl кнопку намеренно не
    // разблокировал — страница уже уходила. Но Safari (в том числе мобильная) и
    // Firefox восстанавливают страницу из кеша навигации ВМЕСТЕ с состоянием, и
    // единственная кнопка покупки осталась бы заблокированной с надписью
    // «Открываем кассу…» навсегда: перезагрузки «Назад» не делает. У заглушки
    // касса — свой же адрес, так что путь этот самый обычный, а не редкий.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setPending(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  const buy = useCallback(async () => {
    // Кнопка на время запроса и так заблокирована; эта проверка страхует
    // повторный вызов из LoginPanel (onSignedIn), которая про её состояние
    // ничего не знает.
    if (pending) return;
    setPending(true);
    setRefusal("");

    let res: Response;
    try {
      res = await fetch("/api/pay/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steamId64, locale }),
      });
    } catch {
      // Офлайн, DNS, оборванное соединение. Без этого catch отказ промиса
      // остался бы необработанным, а человек — без единого слова на экране.
      setRefusal("failed");
      setPending(false);
      return;
    }

    // Тело разбираем один раз на все исходы: в удачном лежит адрес кассы, в
    // отказном — `code`, по которому выбирается текст. Пустое или битое тело
    // читается как отказ без подробностей, а не роняет обработчик.
    const data: { payUrl?: unknown; code?: unknown } = await res.json().catch(() => ({}));

    if (res.ok) {
      if (typeof data.payUrl === "string" && data.payUrl) {
        // Уход на кассу — не клиентский переход: адрес по смыслу внешний, а при
        // `live` он и будет чужим доменом. Кнопку намеренно не разблокируем:
        // страница уже уходит, и второе нажатие завело бы вторую попытку.
        window.location.href = data.payUrl;
        return;
      }
      setRefusal("failed");
    } else if (res.status === 401) {
      // Вход просят ровно здесь и нигде больше (решение владельца): человек уже
      // решился платить, и только в этот момент личность становится нужна.
      setNeedLogin(true);
    } else if (res.status === 409) {
      // Разбор уже куплен — на сервере он открыт, а страница показывает старое.
      setRefusal("alreadyOwned");
      router.refresh();
    } else {
      // Отказ на срок решает не статус, а `code`: «касса не подключена» держится
      // до вмешательства владельца, и совет «попробуй ещё раз» на него — обещание,
      // которое не сбудется ни разу. Честное «пока нельзя» полезнее.
      // Отказ на срок решает не статус, а `code`. «Разбора нет» — это не
      // поломка кассы: карточка успела истечь, пока человек читал витрину, и
      // помогает не повтор нажатия, а пересчёт разбора.
      setRefusal(
        data.code === "no_provider" ? "unavailable" : data.code === "no_analysis" ? "expired" : "failed",
      );
    }

    setPending(false);
  }, [pending, steamId64, locale, router]);

  return (
    <div className="rounded-2xl border border-purple-500/40 bg-gray-900/80 p-5 sm:p-6 space-y-5">
      <div className="space-y-1 text-center">
        <h2 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-transparent">
          {t("paywall.title")}
        </h2>
        <p className="text-sm text-gray-400">{t("paywall.subtitle")}</p>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">
          {t("paywall.whatYouGet")}
        </p>
        <ul className="space-y-2">
          {/* Строку про роасты убираем, когда закрытых нет вовсе: старая карточка
              из кеша может нести один-единственный роаст, и «ещё 0 роастов» — то
              же враньё, что и «ещё пять», только наоборот. */}
          {INCLUDES.filter((item) => item.key !== "roasts" || lockedCount > 0).map((item) => (
            <li key={item.key} className="flex items-start gap-3 bg-gray-800/50 rounded-lg px-3 py-2.5">
              <span className="text-lg flex-shrink-0" aria-hidden="true">
                {item.icon}
              </span>
              {/* Число подставляется во все строки списка разом: лишние значения
                  перевод молча игнорирует, а роастам оно нужно настоящее. */}
              <span className="text-sm text-gray-200">
                {t(`paywall.includes.${item.key}`, { count: lockedCount })}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-3">
        <button
          onClick={buy}
          disabled={pending}
          className="w-full px-4 py-3.5 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-60 disabled:cursor-wait text-white font-bold text-sm sm:text-base transition-colors"
        >
          {pending ? t("paywall.buying") : t("paywall.buy", { price: priceInRubles() })}
        </button>

        {/* Дисклеймер живёт рядом с кнопкой, а не только в подвале: человек
            платит именно здесь, и здесь же обязан прочесть, что покупает
            развлечение, а не заключение специалиста (RISK-1 из ревью). */}
        <p className="text-xs leading-relaxed text-gray-400 text-center">
          {t("paywall.disclaimer")}
        </p>

        {refusal && (
          <p role="alert" className="text-sm text-red-400 text-center">
            {t(`paywall.${refusal}`)}
          </p>
        )}

        {/* Чем кончился вход через Steam. Тексты те же, что показывает панель
            входа на свои отказы, — заводить вторые незачем. */}
        {showLoginOutcome && (
          <p role="alert" className="text-sm text-red-400 text-center">
            {t(`auth.${showLoginOutcome}`)}
          </p>
        )}
      </div>

      {needLogin && (
        <div className="rounded-xl border border-gray-700 bg-gray-950/60 p-4 space-y-3">
          <p className="text-sm text-gray-300 text-center">{t("paywall.loginHint")}</p>
          {/* Вход состоялся — сразу повторяем покупку: человек нажимал «купить»,
              а не «войти», и второе нажатие ему возвращать незачем. */}
          {/* backSteamId — чтобы вход через Steam вернул человека СЮДА. Он
              уводит браузер целиком, и без этого возврат приходился на лендинг:
              вошёл, но выброшен с разбора, который собирался купить. */}
          <LoginPanel
            backSteamId={steamId64}
            onSignedIn={() => {
              setNeedLogin(false);
              // Прошлый неудачный вход больше не новость: этот удался.
              setLoginDismissed(true);
              buy();
            }}
          />
        </div>
      )}
    </div>
  );
}

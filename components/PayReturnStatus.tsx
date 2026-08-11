"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

interface Props {
  orderId: number;
  locale: string;
}

/** Как часто спрашиваем статус и сколько всего ждём. */
const POLL_EVERY_MS = 2000;
const POLL_LIMIT_MS = 60_000;

/**
 * Потолок на ОДИН запрос. Минутный потолок проверяется между тиками, и без
 * этого таймаута он не спасает от главного случая: телефон в метро или
 * captive-portal, который соединение принимает и молчит. Промис не разрешается
 * никогда, тика не будет, минута не наступит — крутилка висит вечно, и кнопка
 * «я оплатил» не появляется вовсе.
 */
const REQUEST_TIMEOUT_MS = 8000;

type Phase = "waiting" | "paid" | "declined" | "delayed" | "signedOut";

/**
 * Возврат с кассы.
 *
 * Пока подтверждение не пришло, здесь написано «ждём подтверждения банка», а НЕ
 * «не оплачено». Разница не косметическая: человек уже отдал деньги, и слово
 * «не оплачено» на этом экране — прямая ложь, из-за которой он пойдёт платить
 * второй раз.
 *
 * Через минуту опрос прекращается. Бесконечная крутилка недопустима: она ничего
 * не сообщает и не заканчивается, поэтому вместо неё — объяснение и кнопка «я
 * оплатил», спрашивающая статус немедленно.
 */
export function PayReturnStatus({ orderId, locale }: Props) {
  const t = useTranslations();
  const [phase, setPhase] = useState<Phase>("waiting");
  const [checking, setChecking] = useState(false);
  const [stillWaiting, setStillWaiting] = useState(false);
  const [steamId64, setSteamId64] = useState<string | null>(null);

  // Живой ли ещё компонент. Уход со страницы посреди запроса не должен
  // приводить к записи состояния в размонтированный компонент.
  const alive = useRef(true);

  /** Возвращает true, если судьба заказа решилась и спрашивать больше нечего. */
  const check = useCallback(async (): Promise<boolean> => {
    // Свой AbortController, а не AbortSignal.timeout: последний есть не во всех
    // браузерах, которые сюда приходят с телефона.
    const abort = new AbortController();
    const cutoff = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(`/api/pay/status/${orderId}`, {
        cache: "no-store",
        signal: abort.signal,
      });

      // Сессия кончилась (вышел в соседней вкладке, протухла кука). Ждать
      // дальше бессмысленно: право выдано и висит на аккаунте, но пока человек
      // не войдёт заново, страница разбора его не покажет — «доступ откроется
      // сам» было бы враньём. Опрос прекращаем и просим войти.
      if (res.status === 401) {
        if (alive.current) setPhase("signedOut");
        return true;
      }

      // 404/503 — не повод объявить «не оплачено»: база могла не ответить.
      // Продолжаем спрашивать, пока не кончится минута.
      if (!res.ok) return false;

      const data: { status?: unknown; steamId64?: unknown } = await res.json();
      if (!alive.current) return true;

      if (data.status === "paid" && typeof data.steamId64 === "string") {
        setPhase("paid");
        setSteamId64(data.steamId64);
        // Полный переход, а не router.push: страница разбора рисуется на
        // сервере по праву доступа, а клиентский переход берёт ответ из кеша
        // маршрутизатора — того самого, что был получен ДО оплаты. Покупатель
        // увидел бы бесплатный вид сразу после успешной оплаты.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = `/${locale}/result/${data.steamId64}`;
        return true;
      }
      if (data.status === "cancelled") {
        setPhase("declined");
        if (typeof data.steamId64 === "string") setSteamId64(data.steamId64);
        return true;
      }
      if (typeof data.steamId64 === "string") setSteamId64(data.steamId64);
      return false;
    } catch {
      // Сеть моргнула или запрос сняли по таймауту — это не ответ банка.
      // Просто попробуем ещё раз, а потолок в минуту всё закончит.
      return false;
    } finally {
      clearTimeout(cutoff);
    }
  }, [orderId, locale]);

  useEffect(() => {
    alive.current = true;
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      const settled = await check();
      if (!alive.current || settled) return;

      if (Date.now() - startedAt >= POLL_LIMIT_MS) {
        setPhase("delayed");
        return;
      }
      timer = setTimeout(tick, POLL_EVERY_MS);
    };

    void tick();

    return () => {
      // Живых таймеров после ухода со страницы не остаётся.
      alive.current = false;
      if (timer) clearTimeout(timer);
    };
  }, [check]);

  const checkNow = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    setStillWaiting(false);
    const settled = await check();
    if (!alive.current) return;
    if (!settled) setStillWaiting(true);
    setChecking(false);
  }, [check, checking]);

  const backHref = steamId64 ? `/${locale}/result/${steamId64}` : `/${locale}`;

  return (
    <div className="space-y-4 text-center">
      {phase === "waiting" && (
        <>
          <div
            className="mx-auto w-10 h-10 rounded-full border-2 border-purple-500/40 border-t-purple-400 animate-spin"
            aria-hidden="true"
          />
          <p className="text-base text-gray-200" role="status">
            {t("pay.return.waiting")}
          </p>
          <p className="text-sm text-gray-500">{t("pay.return.waitingHint")}</p>
        </>
      )}

      {phase === "paid" && (
        <p className="text-base text-green-300" role="status">
          {t("pay.return.paid")}
        </p>
      )}

      {phase === "declined" && (
        <>
          <p className="text-base text-red-300" role="status">
            {t("pay.return.declined")}
          </p>
          <a
            href={backHref}
            className="inline-block px-6 py-3 rounded-xl bg-gray-800 hover:bg-gray-700 text-sm font-semibold text-gray-200 transition-colors"
          >
            {t("pay.backToResult")}
          </a>
        </>
      )}

      {/* Умершая сессия не должна выглядеть как ожидание. Кнопки «я оплатил»
          здесь нет намеренно: спрашивать статус нечем, пока никто не вошёл. */}
      {phase === "signedOut" && (
        <>
          <p className="text-base text-amber-300" role="status">
            {t("pay.return.signedOut")}
          </p>
          <a
            href={backHref}
            className="inline-block px-6 py-3 rounded-xl bg-gray-800 hover:bg-gray-700 text-sm font-semibold text-gray-200 transition-colors"
          >
            {t("pay.backToResult")}
          </a>
        </>
      )}

      {phase === "delayed" && (
        <>
          <p className="text-base text-gray-200" role="status">
            {t("pay.return.delayed")}
          </p>
          <button
            onClick={checkNow}
            disabled={checking}
            className="w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-60 disabled:cursor-wait text-white font-bold text-sm transition-colors"
          >
            {checking ? t("pay.return.checking") : t("pay.return.iPaid")}
          </button>
          {stillWaiting && <p className="text-sm text-gray-500">{t("pay.return.stillWaiting")}</p>}
          <div>
            <a href={backHref} className="text-sm text-gray-500 hover:text-gray-300 transition-colors">
              {t("pay.backToResult")}
            </a>
          </div>
        </>
      )}
    </div>
  );
}

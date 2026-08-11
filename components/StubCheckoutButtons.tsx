"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { priceInRubles } from "@/lib/billing/price";

interface Props {
  orderId: number;
  locale: string;
  /** Куда уводит «уйти не заплатив» — на тот самый разбор, что покупается. */
  steamId64: string;
  amountKop: number;
}

type Outcome = "paid" | "declined";

/**
 * Кнопки поддельной кассы.
 *
 * Подтверждение готовит сервер (`/api/pay/stub/{id}`), а отправляет его в
 * вебхук браузер — обычным fetch на относительный адрес. Так проверяется весь
 * путь целиком (маршрутизация, заголовок подписи, рантайм), ровно как приходит
 * настоящий банк, и при этом никто не угадывает собственный адрес сайта.
 *
 * Ни секрета, ни суммы, ни номера заказа этот компонент не задаёт: он
 * пересылает ровно ту строку и ровно ту подпись, что получил.
 */
export function StubCheckoutButtons({ orderId, locale, steamId64, amountKop }: Props) {
  const t = useTranslations();
  const [pending, setPending] = useState<Outcome | null>(null);
  const [failed, setFailed] = useState(false);

  const send = useCallback(
    async (outcome: Outcome) => {
      if (pending) return;
      setPending(outcome);
      setFailed(false);

      try {
        const prepared = await fetch(`/api/pay/stub/${orderId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ outcome }),
        });
        if (!prepared.ok) throw new Error(`stub ${prepared.status}`);

        const data: { body?: unknown; signature?: unknown; header?: unknown } =
          await prepared.json();
        if (
          typeof data.body !== "string" ||
          typeof data.signature !== "string" ||
          typeof data.header !== "string"
        ) {
          throw new Error("касса вернула не подтверждение");
        }

        // Тело уходит ТОЙ ЖЕ строкой, какую подписал сервер: подпись считается
        // по байтам, и пересобранный здесь JSON её бы развалил.
        const hook = await fetch("/api/pay/webhook", {
          method: "POST",
          headers: { "Content-Type": "application/json", [data.header]: data.signature },
          body: data.body,
        });
        // 409 — не отказ, а «судьба заказа уже решена»: оплачен в соседней
        // вкладке, отменён, сумма не сошлась. Совет «попробуй ещё раз» на него
        // не сбудется НИКОГДА, сколько ни жми, — а страница возврата покажет
        // настоящий статус заказа. Туда и уводим, как при удачном исходе.
        if (!hook.ok && hook.status !== 409) throw new Error(`webhook ${hook.status}`);

        // Уход на страницу возврата — не клиентский переход: при живой кассе
        // сюда браузер возвращается с чужого домена целой перезагрузкой, и путь
        // должен совпадать, иначе поддельная касса проверяет не то, что будет.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = `/${locale}/pay/return?orderId=${orderId}`;
      } catch (err) {
        // Офлайн, оборванное соединение, отказ вебхука. Молчать нельзя: человек
        // нажал кнопку оплаты и обязан понять, что ничего не произошло.
        console.error("[pay] поддельная касса не смогла отправить подтверждение:", err);
        setFailed(true);
        setPending(null);
      }
    },
    [pending, orderId, locale],
  );

  return (
    <div className="space-y-3">
      <button
        onClick={() => send("paid")}
        disabled={pending !== null}
        className="w-full px-4 py-3.5 rounded-xl bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 disabled:opacity-60 disabled:cursor-wait text-white font-bold text-sm sm:text-base transition-colors"
      >
        {pending === "paid" ? t("pay.sending") : t("pay.pay", { price: priceInRubles(amountKop) })}
      </button>

      <button
        onClick={() => send("declined")}
        disabled={pending !== null}
        className="w-full px-4 py-3 rounded-xl border border-red-500/50 text-red-300 hover:bg-red-500/10 disabled:opacity-60 disabled:cursor-wait font-semibold text-sm transition-colors"
      >
        {pending === "declined" ? t("pay.sending") : t("pay.decline")}
      </button>

      {/* Обычная ссылка, без единого запроса: брошенный заказ обязан остаться
          незакрытым — это самый частый исход в жизни, и следующее нажатие
          «купить» подхватит именно его. */}
      <a
        href={`/${locale}/result/${steamId64}`}
        className="block text-center px-4 py-3 text-sm text-gray-400 hover:text-gray-200 transition-colors"
      >
        {t("pay.leave")}
      </a>

      {failed && (
        <p role="alert" className="text-sm text-red-400 text-center">
          {t("pay.failed")}
        </p>
      )}
    </div>
  );
}

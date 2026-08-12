import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { StubCheckoutButtons } from "@/components/StubCheckoutButtons";
import { priceInRubles } from "@/lib/billing/price";
import { findOrder } from "@/lib/billing/store";
import { getStubProvider } from "@/lib/billing/stub-provider";
import { profileKey } from "@/lib/cache/keys";
import { getCache } from "@/lib/cache/redis";
import { getCurrentAccountId } from "@/lib/identity/session";
import type { AggregatedProfile } from "@/lib/aggregation/types";

interface Props {
  // В Next 15+ параметры маршрута приходят промисом. Сборка про синхронное
  // чтение молчит, а страница ломается в рантайме — в этом проекте уже обжигались.
  params: Promise<{ locale: string; orderId: string }>;
}

/** Страница оплаты в поиске не нужна: она про один конкретный чужой заказ. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Поддельная касса.
 *
 * Все отказы — `notFound()`, и это осознанно: страница не должна рассказывать,
 * существует ли чужой заказ. «Нет такого», «он не твой» и «касса выключена»
 * выглядят одинаково.
 */
export default async function StubCheckoutPage({ params: rawParams }: Props) {
  const params = await rawParams;
  const t = await getTranslations();
  const termsUrl = process.env.TERMS_URL;

  // Поддельной кассы может не быть вовсе: режим не `stub` либо боевое окружение
  // без явного PAYWALL_ALLOW_STUB_IN_PROD=true. Оба предохранителя внутри.
  if (!getStubProvider()) notFound();

  const id = Number(params.orderId);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const order = findOrder(id);
  if (!order) notFound();

  // Заказ принадлежит аккаунту, а не браузеру: без входа и с чужим входом
  // страницы просто нет.
  const accountId = await getCurrentAccountId();
  if (!accountId || order.accountId !== accountId) notFound();

  // Чей разбор покупается. Профиль мог истечь — тогда показываем номер: он
  // всё равно однозначно называет товар.
  const profile = await getCache<AggregatedProfile>(profileKey(order.steamId64));
  const subject = profile?.player.name || order.steamId64;

  const open = order.status === "created";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-4">
        {/*
          Плашка несмываемая и заметная: это первое, что должно броситься в
          глаза. Серым по серому её нельзя — человек, решивший, что платит
          по-настоящему, потом ищет списание в банке.
        */}
        <div className="rounded-xl border-2 border-yellow-400 bg-yellow-400/15 px-4 py-3 text-center space-y-1">
          <p className="text-sm font-bold uppercase tracking-wider text-yellow-300">
            {t("pay.testMode")}
          </p>
          <p className="text-xs text-yellow-200/80">{t("pay.testModeHint")}</p>
        </div>

        <div className="rounded-2xl border border-gray-800 bg-gray-900/80 p-5 sm:p-6 space-y-5">
          <h1 className="text-xl font-bold text-center text-gray-100">{t("pay.title")}</h1>

          <div className="space-y-2">
            {/* Имя разбора переносится, а не обрезается: человек обязан видеть
                целиком, за что платит. */}
            <p className="text-sm text-gray-400 break-words">
              {t("pay.subject", { name: subject })}
            </p>
            <div className="flex items-baseline justify-between gap-3 border-t border-gray-800 pt-3">
              <span className="text-xs uppercase tracking-wider text-gray-500">
                {t("pay.amount")}
              </span>
              {/* Сумма из ЗАКАЗА, а не из константы: заказ мог быть заведён по
                  другой цене, и вебхук потом сверяет уплаченное именно с ним. */}
              <span className="font-mono text-2xl font-bold text-gray-100">
                {priceInRubles(order.amountKop)} ₽
              </span>
            </div>
          </div>

          {/* Дисклеймер стоит НАД кнопками и набран читаемо (RISK-1 из ревью).
              Одиннадцать пикселей серым по серому под кнопками — это текст,
              который не прочтёт никто, а смысл требования ровно обратный:
              человек обязан ДО оплаты понять, что покупает шутку про себя.
              Плашка тестового режима громкости не пожалела — этот текст важнее. */}
          <p className="text-sm leading-relaxed text-gray-300 border-l-2 border-gray-700 pl-3">
            {t("pay.disclaimer")}
          </p>

          {/* Ссылка на оферту и правила возврата. Появляется только когда адрес
              задан: выдумывать правила возврата за владельца нельзя, а до
              настоящей кассы их и не существует. Читается на сервере при показе
              страницы, а не вшивается в сборку. */}
          {termsUrl && (
            <p className="text-xs text-gray-500">
              <a href={termsUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-300">
                {t("pay.terms")}
              </a>
            </p>
          )}

          {open ? (
            <StubCheckoutButtons
              orderId={order.id}
              locale={params.locale}
              steamId64={order.steamId64}
              amountKop={order.amountKop}
            />
          ) : (
            /* Закрытый заказ платить нельзя — по нему касса денег не возьмёт.
               Вместо кнопок внятная строка и дорога назад: оттуда нажатие
               «купить» заведёт новый заказ. */
            <div className="space-y-3 text-center">
              <p className="text-sm text-gray-300">{t("pay.closed")}</p>
              <a
                href={`/${params.locale}/result/${order.steamId64}`}
                className="inline-block px-6 py-3 rounded-xl bg-gray-800 hover:bg-gray-700 text-sm font-semibold text-gray-200 transition-colors"
              >
                {t("pay.backToResult")}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PayReturnStatus } from "@/components/PayReturnStatus";

interface Props {
  // В Next 15+ и параметры маршрута, и строка запроса приходят промисами.
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Страница про один конкретный заказ — в поиске ей делать нечего. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Возврат с кассы.
 *
 * Номер заказа приходит в строке запроса — так же, как его вернёт настоящий
 * эквайер. Сама страница ничего о заказе не знает и знать не должна: статус
 * спрашивает браузер у `/api/pay/status/{id}`, а тот отдаёт его только хозяину
 * заказа.
 */
export default async function PayReturnPage({ params: rawParams, searchParams }: Props) {
  const params = await rawParams;
  const t = await getTranslations();

  const raw = (await searchParams).orderId;
  // Массив означает `?orderId=1&orderId=2` — подсунутая строка запроса, а не
  // возврат с кассы. Читать из неё первое попавшееся незачем.
  const id = Number(typeof raw === "string" ? raw : NaN);
  if (!Number.isInteger(id) || id <= 0) notFound();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-4">
        {/* Плашка держится и здесь: возврат — часть той же поддельной кассы, и
            человек не должен решить, что с него списали настоящие деньги. */}
        <div className="rounded-xl border-2 border-yellow-400 bg-yellow-400/15 px-4 py-3 text-center">
          <p className="text-sm font-bold uppercase tracking-wider text-yellow-300">
            {t("pay.testMode")}
          </p>
        </div>

        <div className="rounded-2xl border border-gray-800 bg-gray-900/80 p-5 sm:p-6 space-y-5">
          <h1 className="text-xl font-bold text-center text-gray-100">{t("pay.return.title")}</h1>
          <PayReturnStatus orderId={id} locale={params.locale} />
        </div>
      </div>
    </div>
  );
}

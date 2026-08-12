import type { Wealth } from "@/lib/wealth/types";

interface Labels {
  title: string;
  accountValue: string;
  library: string;
  inventory: string;
  unplayed: string;
  perHour: string;
  avgPrice: string;
  cards: string;
  notable: string;
  unpricedCount: string;
  unpricedNote: string;
  marketNote: string;
  estimatedNote: string;
  privateInventory: string;
  inventoryUnavailable: string;
  storeNote: string;
}

const rub = (value: number) => `${Math.round(value).toLocaleString("ru-RU")} ₽`;

export function WealthCard({ wealth, labels }: { wealth: Wealth; labels: Labels }) {
  return (
    <div className="bg-gray-900/50 rounded-xl p-4 border border-gray-800 space-y-4">
      <h3 className="text-sm font-semibold text-gray-300">{labels.title}</h3>

      <div>
        <div className="text-xs text-gray-500">{labels.accountValue}</div>
        <div className="text-3xl font-bold font-mono text-emerald-400">{rub(wealth.total)}</div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <Stat label={labels.library} value={rub(wealth.library.total)} />
        <Stat
          label={labels.inventory}
          value={wealth.inventory.status === "ok" ? rub(wealth.inventory.total) : "—"}
        />
        <Stat label={labels.unplayed} value={rub(wealth.unplayed.value)} />
        <Stat label={labels.perHour} value={rub(wealth.library.perHour)} />
        <Stat label={labels.avgPrice} value={rub(wealth.library.avgPrice)} />
        {wealth.inventory.cardsEstimated > 0 && (
          <Stat label={labels.cards} value={`${wealth.inventory.cardsEstimated}`} />
        )}
      </div>

      {wealth.inventory.top.length > 0 && (
        <ul className="space-y-1 text-sm">
          {wealth.inventory.top.map((item) => (
            <li key={item.name} className="flex justify-between gap-3">
              <span className="text-gray-300 truncate">
                {item.qty > 1 ? `${item.qty}× ` : ""}
                {item.name}
              </span>
              {/* totalRub уже стоимость всей стопки — на количество не умножаем. */}
              <span className="text-gray-100 shrink-0">{rub(item.totalRub)}</span>
            </li>
          ))}
        </ul>
      )}

      {wealth.inventory.notable.length > 0 && (
        <div className="text-sm text-gray-400">
          {labels.notable}: {wealth.inventory.notable.join(", ")}
        </div>
      )}

      {/* Предметы, которых нет в прайс-листе рынка: деньги за них не вошли в
          сумму, но молча пропадать с витрины они не должны — иначе итог
          выглядит точным там, где он занижен. */}
      {wealth.inventory.unpricedItems > 0 && (
        <div className="text-sm text-gray-400">
          {labels.unpricedCount}: {wealth.inventory.unpricedItems}
          <span className="block text-xs text-gray-600">{labels.unpricedNote}</span>
        </div>
      )}

      <div className="space-y-1 text-xs text-gray-600">
        <div>{labels.storeNote}</div>
        {wealth.inventory.status === "private" ? (
          <div>{labels.privateInventory}</div>
        ) : wealth.inventory.status === "unavailable" ? (
          // Steam не ответил / лимит / оборвалась связь — это не приватность
          // и не оценка по рынку. Число рядом уже честно показывает прочерк,
          // подпись не должна утверждать, что оценка была.
          <div>{labels.inventoryUnavailable}</div>
        ) : (
          <div>{labels.marketNote}</div>
        )}
        {wealth.library.estimated && <div>{labels.estimatedNote}</div>}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-gray-500 text-xs">{label}</div>
      <div className="text-lg font-semibold font-mono text-white">{value}</div>
    </div>
  );
}

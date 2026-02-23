import { getGateFunnel } from "@/lib/analytics/queries";
import StatCard from "@/components/admin/StatCard";
import ChartCard from "@/components/admin/ChartCard";
import TelegramCharts from "./charts";

export const dynamic = "force-dynamic";

export default function TelegramPage() {
  const funnel = getGateFunnel();

  const created = funnel.find((f) => f.event === "created")?.count || 0;
  const unlocked = funnel.find((f) => f.event === "unlocked")?.count || 0;
  const notSubscribed = funnel.find((f) => f.event === "not_subscribed")?.count || 0;
  const conversionRate = created > 0 ? Math.round((unlocked / created) * 100 * 10) / 10 : 0;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Telegram</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Gates created" value={created} />
        <StatCard label="Unlocked" value={unlocked} />
        <StatCard label="Not subscribed" value={notSubscribed} />
        <StatCard label="Конверсия" value={`${conversionRate}%`} sub="unlocked / created" />
      </div>

      <ChartCard title="Воронка">
        <TelegramCharts funnel={funnel} />
      </ChartCard>
    </div>
  );
}

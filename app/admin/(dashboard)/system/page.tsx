import { getRecentErrors, getDbSize, getTableCounts } from "@/lib/analytics/queries";
import StatCard from "@/components/admin/StatCard";
import ChartCard from "@/components/admin/ChartCard";
import DataTable from "@/components/admin/DataTable";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

function getArtFolderSize(): string {
  const artPath = process.env.ART_STORAGE_PATH || "/data/art";
  try {
    const files = fs.readdirSync(artPath);
    let totalSize = 0;
    for (const file of files) {
      try {
        const stat = fs.statSync(path.join(artPath, file));
        totalSize += stat.size;
      } catch { /* skip */ }
    }
    return `${files.length} files, ${(totalSize / 1024 / 1024).toFixed(1)} MB`;
  } catch {
    return "N/A";
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
}

export default function SystemPage() {
  const dbSize = getDbSize();
  const tables = getTableCounts();
  const errors = getRecentErrors();
  const artInfo = getArtFolderSize();

  const errorsFormatted = errors.map((e) => ({
    ...e,
    time: formatTimestamp(e.timestamp),
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Система</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="SQLite размер" value={formatBytes(dbSize)} />
        <StatCard label="Арт-папка" value={artInfo} />
        <StatCard label="Записей в analyses" value={tables.analyses} />
        <StatCard label="Записей в errors" value={tables.errors} />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="art_generations" value={tables.art_generations} />
        <StatCard label="gate_events" value={tables.gate_events} />
      </div>

      <ChartCard title="Последние 50 ошибок">
        <DataTable
          columns={[
            { key: "time", label: "Время" },
            { key: "type", label: "Тип" },
            { key: "message", label: "Сообщение" },
            { key: "endpoint", label: "Endpoint" },
          ]}
          rows={errorsFormatted}
        />
      </ChartCard>
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";

const NAV_ITEMS = [
  { href: "/admin", label: "Обзор", icon: "📊" },
  { href: "/admin/traffic", label: "Трафик", icon: "📈" },
  { href: "/admin/users", label: "Пользователи", icon: "👤" },
  { href: "/admin/costs", label: "Расходы", icon: "💰" },
  { href: "/admin/telegram", label: "Telegram", icon: "📱" },
  { href: "/admin/system", label: "Система", icon: "⚙️" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950 p-4">
      <Link href="/admin" className="mb-8 text-lg font-bold text-white">
        GamerType
        <span className="ml-2 text-xs text-zinc-500">admin</span>
      </Link>
      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-purple-600/20 text-purple-400"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-white",
              )}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto pt-4">
        <Link href="/" className="text-xs text-zinc-600 hover:text-zinc-400">
          ← На сайт
        </Link>
      </div>
    </aside>
  );
}

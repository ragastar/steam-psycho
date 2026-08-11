import "@/app/globals.css";

export const metadata = {
  title: "Задротометр — админка",
  robots: "noindex, nofollow",
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="bg-zinc-900 text-white">{children}</body>
    </html>
  );
}

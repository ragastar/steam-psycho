import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "avatars.steamstatic.com" },
      { protocol: "https", hostname: "steamcdn-a.akamaihd.net" },
      { protocol: "https", hostname: "cdn.akamai.steamstatic.com" },
    ],
  },
  // В Next 15 настройка переехала из experimental и сменила имя.
  serverExternalPackages: ["@resvg/resvg-js", "better-sqlite3"],
};

export default withNextIntl(nextConfig);

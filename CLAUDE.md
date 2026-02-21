# GamerType (ex Steam Psycho)

AI-психоанализ по библиотеке Steam. Генерирует развлекательный психологический портрет на основе игровых предпочтений.

## Stack
- **Next.js 14** + TailwindCSS 3 + TypeScript
- **LLM**: OpenAI (GPT-4o-mini) + Anthropic (Claude Sonnet) via OpenRouter
- **AI Art**: DALL-E 3 via OpenRouter (~$0.04/image)
- **i18n**: next-intl v4 (RU + EN), роутинг `/ru/...`, `/en/...`
- **Cache**: Upstash Redis + in-memory fallback (globalThis)
- **Card**: Satori + @resvg/resvg-js → PNG 1200x630
- **Fonts**: Inter (UI), Cinzel (archetypes), JetBrains Mono (stats)
- **Deploy target**: Docker on VPS

## Key paths
- `lib/steam/` — Steam Web API (resolve, client, enrich via SteamSpy + Store)
- `lib/aggregation/` — data aggregation: 6 stats, economics, platforms, timeline, social, achievements, badges, patterns, ranks
- `lib/llm/` — multi-provider LLM client (prompt.ts, client.ts, types.ts) — 3 archetypes, 6 stats, 6 roasts
- `lib/art/` — AI art generation (prompt-builder, image-client via DALL-E 3)
- `lib/cache/` — Redis + in-memory cache with TTL (portrait v3, art v1)
- `lib/card/` — Satori card renderer (OG image)
- `lib/telegram/` — Grammy bot for Telegram gating
- `app/[locale]/` — i18n pages (landing, result with 3 tabs)
- `app/api/analyze/` — main orchestrator (friends, badges, achievements)
- `app/api/art/generate/` — AI art generation endpoint
- `app/api/og/[id]/` — PNG download
- `components/Card/` — Card tab components (CardHeader, StatsGrid, ArchetypeBadges, RoastsList, TopGamesCompact)
- `components/DeepDive/` — Deep Dive tab (Economics, Achievements, Platforms, Timeline, Social, Patterns, Ranks, Badges)
- `components/ArtGen/` — Art Gen tab (PipelineViz, PromptDisplay, DataMapping, SchemaDisplay)
- `messages/` — ru.json, en.json translations

## Commands
- `npm run dev` — dev server
- `npm run build` — production build
- Env vars in `.env.local` (see `.env.local.example`)

## GitHub
- Repo: https://github.com/ragastar/steam-psycho
- Branch: master

## Status (per PRD v3.0, 21 Feb 2026)

### MVP v0.1 ✅ Done
- [x] Steam API integration (Resolve, Summaries, OwnedGames, Recent, Level)
- [x] Data aggregation (genres, tags, playtime, stats)
- [x] LLM portrait via OpenRouter (GPT-4o-mini, ~$0.003/portrait)
- [x] Landing with i18n (RU/EN)
- [x] Result page (traits, genres, stats)
- [x] OG image (Satori → PNG 1200x630)
- [x] Share: PNG, clipboard, Twitter, Telegram, VK
- [x] Rate limiting + error handling
- [x] Deploy: Docker + Nginx + SSL on VPS
- [x] CI/CD: GitHub Actions → auto-deploy on push to master
- [x] Rebrand: Steam Psycho → GamerType

### v0.2 "Full Farsh" ✅ Done
- [x] 6 stats: dedication, mastery, exploration, hoarding, social, veteran
- [x] 3 archetypes: primary, secondary, shadow (with colors)
- [x] 6 roasts with severity (critical/legendary/epic/rare) and source
- [x] AI art generation: element + creature → DALL-E 3 via OpenRouter
- [x] 3 tabs UI: Card / Deep Dive / AI Art
- [x] Steam API: achievements (top-10), friends, badges
- [x] Economics: library value, wasted, $/hour, best deal
- [x] Platforms: Windows/Linux/Deck breakdown
- [x] Timeline: account age, trend, monthly hours
- [x] Social: friends count, oldest/newest, per year
- [x] Patterns: genre concentration, binge style, indie %
- [x] Ranks: percentiles (hours, library, concentration, veteran)
- [x] Shimmer/pulse-glow animations, Cinzel + JetBrains Mono fonts
- [x] TelegramGate: blurs tab 2 fully + roasts from tab 1
- [x] Tab 3 (Art Gen) open: pipeline viz, prompt display, data mapping, JSON viewer
- [x] Graceful degradation: private friends/badges → empty sections
- [x] Cache v3 + art cache (30 days)
- [x] ~50 new i18n keys (RU + EN)
- [x] OG image updated for new schema (top-3 stats, primary archetype + title)

### v0.3
- [ ] Profile comparison (compatibility)
- [ ] Steam OpenID login
- [ ] Referral system

### v1.0
- [ ] Discord/Telegram bots
- [ ] Public API

## Business Model
- Product = funnel for Telegram channel growth
- First generation: free for subscribing to TG channel
- Extra generations: referral invites
- Channel monetization: ads, partnerships, premium

## LLM Setup
- OpenRouter as unified gateway (no geo-blocks from RU)
- Model controlled by env OPENROUTER_MODEL (user doesn't see/choose)
- Current: openai/gpt-4o-mini
- Integration: OpenAI SDK with baseURL: openrouter.ai/api/v1

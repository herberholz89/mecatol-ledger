# Mecatol Ledger

A stats tracker for Twilight Imperium games. Players log games (players, factions, points, winner) and see win rates by player and by faction. It replaces the group's "Twilight Imperium data" Google Sheet, which can be imported.

**The full plan is in `docs/PLAN.md`: data model, pages, API, import format, deployment and milestones. Read it before starting a milestone.**

## Stack
- **Frontend:** React + Vite + TypeScript, React Router, TanStack Query, react-hook-form + Zod, Tailwind CSS, Recharts
- **Backend:** Hono on Cloudflare Workers (one Worker serves the built React app as static assets and the API under `/api`)
- **Database:** Neon Postgres via `@neondatabase/serverless`; Drizzle ORM + `drizzle-kit` SQL migrations
- **Auth:** Neon Auth (managed Better Auth, `@neon/auth` client), passwordless: 6-digit email code (Email OTP) only. No passwords, no social sign-in. The Worker proxies `/api/auth/*` to `NEON_AUTH_BASE_URL` so cookies stay first-party. Never call `betterAuth()`, add a Better Auth DB adapter, or model the `neon_auth` schema in Drizzle. Design: "Auth design" in `docs/PLAN.md`
- **Email:** Neon Auth sends sign-in codes (shared sender in dev; a dedicated Gmail account as Neon Auth's custom SMTP in production). The Worker sends no email
- **Repo:** pnpm monorepo, `apps/web`, `apps/api`, `packages/shared` (Zod schemas, types, spreadsheet parser)
- **CI/CD:** GitHub Actions: typecheck, lint, test, build; on `main` run migrations, `wrangler deploy`, smoke-test `/api/health`
- **Hosting:** Cloudflare Workers free plan at `mecatol-ledger.<account>.workers.dev`, Neon free plan. Target cost: $0/month

## Conventions
- **TypeScript strict mode** everywhere. No `any` without a comment explaining why.
- **Propose data model changes before writing code that depends on them.** Describe the change and wait for approval.
- **Flag schema changes explicitly** in summaries and PR descriptions (new/changed tables, columns, constraints, views).
- **Keep features small and shippable.** One milestone or sub-feature at a time, each ending in a working, deployable state.
- When delivering a feature, include a short note on anything the user must configure (secrets, env vars, dashboard settings).
- Validation lives in `packages/shared` Zod schemas and is reused by the web forms and the API. The API always re-validates.
- Derived values (winner, winning faction, player count, point spread, win rates) are computed in SQL views or queries, never stored.
- Migrations must be backward compatible (add first, remove later) so rolling back app code never needs a DB rollback.

## Hard constraints (Cloudflare Workers free plan)
- **10 ms CPU per request.** No password hashing, auth crypto or other heavy CPU work on the server (Neon Auth issues and checks codes and sessions; the Worker only proxies and asks for the session). Parse spreadsheets in the browser; the server only validates and inserts JSON. Waiting on the database doesn't count as CPU time.
- 100,000 API requests/day. Static assets are free and unlimited.
- Fastify and other Node-only servers don't run here; use Hono and Web-standard APIs (`nodejs_compat` flag is on).
- Use the Neon serverless driver; use its WebSocket `Pool` per request when a transaction is needed (game writes, imports).

## Domain rules (summary; details in docs/PLAN.md)
- Games have 2–8 players and exactly one winner. The winner has the most points; a tie for most points is allowed only when `ended_early` is set. Points may exceed `vp_target`.
- **Point spread = winner points − second-highest points.**
- Expected win rate = average of 1 / player count across a player's or faction's games; show it next to actual win rate.
- Users (logins) are separate from players (names in games). A user can claim a player.
- Identity lives in Neon's managed `neon_auth` schema. The app's own `app_users` table (id = Neon Auth user id, `uuid`) holds display name and `role`; all user foreign keys point at `app_users`, never into `neon_auth`. Admin checks use `app_users.role`.
- Users edit/delete only games they created; admins can edit/delete anything and manage factions and aliases.
- 30 factions: base (17), Prophecy of Kings (7), Codex (Council Keleres), Thunder's Edge (5). Firmament / Obsidian is **one** faction.
- Shared playgroup rosters are **v2**, not v1.

## Local development
- `pnpm dev`: Vite dev server proxies `/api` to `wrangler dev`.
- Database: a Neon `dev` branch (the serverless driver needs Neon, not plain local Postgres). Production is the Neon `production` branch (the project's default). CI tests run against a Postgres service container.
- Secrets go in `apps/api/.dev.vars` locally (gitignored) and `wrangler secret put` in production. Never commit secrets.

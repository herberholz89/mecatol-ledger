# Mecatol Ledger

A stats tracker for Twilight Imperium games. See [docs/PLAN.md](docs/PLAN.md) for the full plan.

## Layout

| Path | What |
|---|---|
| `apps/web` | React + Vite frontend (built to `apps/web/dist`) |
| `apps/api` | Hono API on Cloudflare Workers. Also serves `apps/web/dist` as static assets. Drizzle schema + migrations in `apps/api/drizzle` |
| `packages/shared` | Zod schemas, types, faction seed data, (later) the spreadsheet parser |

## Local development

Requires Node 22.12+ and pnpm.

```bash
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars   # then set DATABASE_URL, NEON_AUTH_BASE_URL (dev branch) and ADMIN_EMAILS
pnpm db:migrate
pnpm dev                                           # web on :5173, API (wrangler dev) on :8787
```

Checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.

The migration tests need a throwaway Postgres database (it gets wiped):

```bash
createdb mecatol_test
TEST_DATABASE_URL=postgres://localhost/mecatol_test pnpm test
```

## Auth

Sign-in is a 6-digit email code from Neon Auth; there are no passwords. The Worker proxies `/api/auth/*` to the branch's Neon Auth URL (`NEON_AUTH_BASE_URL`) and checks the session on protected routes. Each Neon branch has its own auth URL and users: `neon neon-auth status --branch <name>`.

Branch settings (run once per branch, add `--branch <name>`):

```bash
neon neon-auth config email-password update --enabled false   # codes only
neon neon-auth oauth-provider delete --provider-id google
neon neon-auth config organization update --enabled false
```

Production also needs its origin as a trusted domain, custom SMTP, and localhost turned off (see "Auth design" in `docs/PLAN.md`).

## Database changes

1. Edit `apps/api/src/db/schema.ts`.
2. `pnpm db:generate` writes a new SQL migration in `apps/api/drizzle`. Review and commit it.
3. Migrations must be backward compatible (add first, remove later).

Seed-data changes (factions, aliases) go in a new custom migration: `pnpm --filter @mecatol/api exec drizzle-kit generate --custom --name <name>`. Keep `packages/shared/src/factions.ts` in sync; the migration test checks they match.

## Deployment

Pushing to `main` runs CI, then migrates the Neon `production` branch, deploys the Worker and smoke-tests `/api/health`.
Rollback: `pnpm --filter @mecatol/api exec wrangler rollback`.

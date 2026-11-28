# Mecatol Ledger — V1 Plan

*A stats tracker for Twilight Imperium games.*

Status: **All v1 decisions confirmed 2026-11-26; auth moved to Neon Auth 2026-11-27.** See the decision log at the bottom. Hosting target: **$0/month**.

## Goal
A website where friends log their own TI games and get better stats than the current "Twilight Imperium data" Google Sheet. Anyone can sign up and log games, so faction stats grow across every group using the site. Users edit/delete what they entered; admins manage factions and other permanent data. Existing spreadsheet history can be imported.

---

## 1. Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | **React + Vite + TypeScript (strict)** | React Router, TanStack Query (server state), react-hook-form + Zod (forms), Tailwind CSS, Recharts (stat charts) |
| Backend | **Hono on Cloudflare Workers, TypeScript strict** | REST API under `/api`. Replaces Fastify, which doesn't run on Workers |
| Auth | **Neon Auth (managed Better Auth), passwordless** — *confirmed 2026-11-27, see [Auth design](#auth-design-neon-auth)* | **6-digit email code only** (Email OTP). Password sign-in and social providers turned off on the branch. Neon hosts the auth server and sends the codes; the Worker proxies `/api/auth/*` to it so session cookies stay first-party |
| Validation / shared code | **`packages/shared`**: Zod schemas, types, spreadsheet parser | Same validation in browser and API; parser unit-tested in isolation |
| DB | **PostgreSQL on Neon (free plan)** | `@neondatabase/serverless` driver over **HTTP only**: atomic writes are single statements or non-interactive HTTP transactions (no WebSocket `Pool`; see the CPU budget). Stats as SQL views |
| ORM / migrations | **Drizzle ORM** + SQL migrations (`drizzle-kit`) | |
| Repo | **pnpm monorepo**: `apps/web`, `apps/api`, `packages/shared` | `/Users/cherberholz/WebstormProjects/mecatol-ledger` |
| Hosting | **One Cloudflare Worker (free plan)** at `mecatol-ledger.<account>.workers.dev`, serving the React build as static assets + the API | No custom domain. Sign-in emails sent through a dedicated Gmail account over SMTP. See section 9 |
| Testing | Vitest (parser, stats queries against test Postgres, permission rules); Playwright later | |

---

## 2. Accounts & permissions

**Users vs players are separate.** A *user* is a login. A *player* is a name that appears in games. Many players (e.g. "codey") won't have accounts, and a user can later **claim** a player to link it to their account.

| Action | Anonymous | Signed-in user | Admin |
|---|---|---|---|
| View games, stats, faction pages | ✅ | ✅ | ✅ |
| Log a game | | ✅ | ✅ |
| Edit / delete a game | | Own games only (`created_by`) | Any |
| Create players | | ✅ (in their roster) | ✅ |
| Rename / merge players | | Own roster | Any |
| Delete a player who isn't in any games | | Own roster | Any |
| Import spreadsheet | | ✅ (games owned by importer) | ✅ |
| Undo an import batch | | Own batches | Any |
| Add / edit / archive factions, faction aliases | | | ✅ |
| Manage users / roles | | | ✅ |

Open signups mean junk data can reach global faction stats. Mitigations in v1: every account has a verified email (signing in with an email code proves the address), rate limits on sign-in and code emails, admins can delete any game, and stats can be filtered to "my games / my roster."

---

## 3. Data model

> ⚠️ **Schema changes since first draft:** added `users` (via Better Auth) with `role`; `players.created_by` and `players.user_id`; `games.created_by`, `games.import_batch_id`; `games.played_on` now **nullable** (much spreadsheet history has no date); new `faction_aliases` and `import_batches` tables; player count now **2–8**; `full_spread` removed (spread = 1st − 2nd only).
>
> ⚠️ **Changed 2026-11-27 (Neon Auth, confirmed):** no Better Auth tables in `public` and no `alter table "user"`. Neon owns identity in the `neon_auth` schema. New app-owned **`app_users`** table (id = Neon Auth user id, `display_name`, `role`). Every `created_by` / `user_id` column becomes **`uuid references app_users(id)`** instead of `text references "user"(id)`. No foreign keys point into `neon_auth`.

```sql
-- Identity (email, sessions, OTP codes) lives in Neon Auth's managed `neon_auth` schema.
-- The app never writes to it and has no foreign keys into it.
-- app_users is the app's own record of a signed-in user, created on their first authenticated request.
create table app_users (
  id            uuid primary key,                  -- = neon_auth."user".id (the session's user id)
  email         text not null unique,              -- copied from the session; refreshed on each upsert
  display_name  text,                              -- asked for after first sign-in; null until set
  role          text not null default 'user' check (role in ('user', 'admin')),
  created_at    timestamptz not null default now()
);

create table players (
  id          serial primary key,
  name        text not null,
  created_by  uuid not null references app_users(id),
  user_id     uuid references app_users(id),       -- set when an account claims this player
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (created_by, name)                        -- "Eric" can exist in two different rosters
);
create unique index one_player_per_user on players (user_id) where user_id is not null;

create table factions (
  id          serial primary key,
  name        text not null unique,
  expansion   text not null check (expansion in ('base', 'pok', 'codex', 'thunders_edge')),
  archived    boolean not null default false
);

-- Alternate spellings, used by the importer and search
create table faction_aliases (
  alias       text primary key,                    -- stored lowercased + trimmed
  faction_id  int not null references factions(id)
);

create table import_batches (
  id          serial primary key,
  created_by  uuid not null references app_users(id),
  source_name text not null,                       -- file / sheet name
  created_at  timestamptz not null default now()
);

create table games (
  id               serial primary key,
  played_on        date,                           -- nullable: old games have no date
  vp_target        smallint not null default 10 check (vp_target between 1 and 20),
  ended_early      boolean not null default false,
  notes            text,
  created_by       uuid not null references app_users(id),
  import_batch_id  int references import_batches(id) on delete cascade,  -- undo an import = delete the batch
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table game_players (
  game_id     int not null references games(id) on delete cascade,
  player_id   int not null references players(id),
  faction_id  int not null references factions(id),
  points      smallint not null check (points >= 0),
  is_winner   boolean not null default false,
  primary key (game_id, player_id),
  unique (game_id, faction_id)
);
create unique index one_winner_per_game on game_players (game_id) where is_winner;
```

**App-level rules** (Zod, re-checked by the API before the write):
- 2–8 players per game. The spreadsheet is mostly 2-player games; up to 8 is allowed by Prophecy of Kings.
- Exactly one winner.
- Winner has the most points. A tie for most points is allowed only when `ended_early` is set.
- Points can go over `vp_target` (the sheet has an 11-point win in a 10-point game).

### Derived values (views, never stored)
- Player count, winner, winning faction.
- **Point spread = winner points − second-highest points.**
- Player and faction stats: games, wins, win rate, **expected win rate** (average of 1/player count), average points. Everything can be filtered by player count, which matters because 2-player and 6-player win rates aren't comparable.

```sql
create view game_summary as
select g.id as game_id, g.played_on, g.vp_target, g.ended_early, g.created_by,
       count(*) as player_count,
       max(gp.points) filter (where gp.is_winner)
         - coalesce((select max(points) from game_players x
                     where x.game_id = g.id and not x.is_winner), 0) as point_spread,
       max(gp.player_id)  filter (where gp.is_winner) as winner_player_id,
       max(gp.faction_id) filter (where gp.is_winner) as winner_faction_id
from games g join game_players gp on gp.game_id = g.id
group by g.id;

create view faction_stats as
select gp.faction_id,
       count(*)                              as games,
       count(*) filter (where gp.is_winner)  as wins,
       round(avg(gp.is_winner::int), 3)      as win_rate,
       round(avg(1.0 / gs.player_count), 3)  as expected_win_rate,
       round(avg(gp.points), 2)              as avg_points
from game_players gp join game_summary gs using (game_id)
group by gp.faction_id;
-- player_stats: same shape grouped by player_id.
-- Filtered variants (player count, date range, roster) run as parameterized queries over game_summary.
```

### Faction seed (30)
Taken from the spreadsheet's **Races** tab, so names match existing data.
- **Base (17):** Arborec, Barony of Letnev, Clan of Saar, Embers of Muaat, Emirates of Hacan, Federation of Sol, Ghosts of Creuss, L1Z1X Mindnet, Mentak Coalition, Naalu Collective, Nekro Virus, Sardakk N'orr, Universities of Jol-Nar, Winnu, Xxcha Kingdom, Yin Brotherhood, Yssaril Tribes
- **Prophecy of Kings (7):** Argent Flight, Empyrean, Mahact Gene-Sorcerers, Naaz-Rokha Alliance, Nomad, Titans of Ul, Vuil'raith Cabal
- **Codex (1):** Council Keleres. It's in the existing data, so it's included even though it isn't base, PoK or Thunder's Edge.
- **Thunder's Edge (5):** Crimson Rebellion, Deepwrought Scholarate, Firmament / Obsidian (**one faction**, as in the sheet), Last Bastion, Ral Nel Consortium

Seeded aliases from typos found in the sheet: `necro virus` → Nekro Virus, `the yssaril triobes` → Yssaril Tribes, `the titan of ul` → Titans of Ul, `the vuil'rairh cabal` → Vuil'raith Cabal, `saar` → Clan of Saar. Names are also matched ignoring a leading "The", case and whitespace.

---

## 4. Spreadsheet import

### Source format (observed in "Twilight Imperium data")
- **Games** tab (~40 two-player games), **old data** tab (older two-player games, including some 14-point games), **multiplayer** tab (a few 3-player games, hand-annotated). The **current totals**, **win table** and **questionair** tabs are derived or other data and aren't imported.
- Each game is a block of consecutive rows separated by a blank row. One row per seat: `A` faction, `B` player, `C` score.
- The first row of a block also carries `D` point spread, `E` winner name, `F` winning faction, `G` losing faction. `H` holds either a date like `5/21` (no year, on either row) or a note like "Total Annihilation".
- Columns I onward (per-player faction checklists) are ignored. Placeholder blocks with a lone `0` in column D are skipped.
- Dates in the .xlsx are real date cells (formatted `m/d`), so they keep their year (2026). Only text dates in a .csv need the default year.
- Rows inside a block with text but no faction or score (e.g. "merge above and below for 1 game", a lone "cody") are kept as annotations and shown as warnings.

### Flow (a page at `/import`)
1. **Upload**: the user downloads the sheet as .xlsx (or one tab as .csv) and drops it in. The file is parsed **in the browser** by the shared parser. SheetJS (0.20.3, installed from the vendor's CDN tarball because npm's `xlsx` is stuck at a vulnerable 0.18.5) reads the file; it lives behind a separate `@mecatol/shared/xlsx` entry, loaded only on this page and never bundled into the Worker. Nothing is saved yet.
2. **Pick tabs** to import (default: Games, old data, multiplayer). Tabs can be reordered: games are inserted in tab order, and undated games list newest-inserted first, so older tabs go on top.
3. **Map names**:
   - Every distinct player name (trimmed, so `"Marcus "` becomes `Marcus`) maps to an existing roster player or a new one. Giving two spellings the same new name (or roster player) merges them. New players are created by the import itself, in the same statement, and stay in the roster after an undo.
   - Unknown faction names are matched through aliases. Anything still unmatched must be picked from a dropdown, with an option to save it as a new alias (admins only).
4. **Defaults**:
   - Year for dates without one. **Default 2026** (confirmed for the existing sheet); editable.
   - VP target is inferred as 14 when the top score is 14 or more, otherwise 10, and can be overridden per game.
   - Column H text goes into notes.
5. **Review table**: one row per game with status ✅ OK / ⚠️ warning / ❌ blocked.
   - ❌ **Blocked**: missing player, faction or score, fewer than 2 seats, the same player or faction twice, a tie for top score (unless marked ended early with a winner picked).
   - ⚠️ **Warnings**:
     - the sheet's winner column disagrees with the highest score
     - the sheet's spread differs from the recomputed 1st − 2nd (e.g. the multiplayer Sol/Nekro/Saar game has spread 3 in the sheet, but 1st − 2nd is 1)
     - inline notes like "merge above and below for 1 game"
   - "No date" is shown as an info note but doesn't change a game's status. *(Changed 2026-11-28: as a warning it flagged 65 of the sheet's 78 games and buried the real problems.)*

   Blocked games can be fixed inline or skipped.
6. **Commit**: the normalized JSON is sent in chunks (5 games first, then 25 at a time) (at most 500 games per import), so each request stays under the 10 ms CPU limit (see the CPU budget). The first chunk goes to `POST /api/imports`, which creates the `import_batch`; the rest go to `POST /api/imports/:id/games`, in order. The server re-validates every chunk (same rules as a logged game; archived players and factions are allowed, since imports are history) and writes its new players, games and seats in **one statement** with data-modifying CTEs. Game ids are drawn from the sequence up front so seats can reference them. A name an earlier chunk created resolves to that player. If a chunk fails, the browser deletes the batch, so an import is all or nothing (players created by earlier chunks stay, as with undo).
7. **Undo**: `DELETE /api/imports/:id` removes the whole batch.

Known clean-up in the sheet: the multiplayer tab has seats with no player name and a game whose winner cell is blank, so those games will show as blocked until fixed in the review step.

**Result against the real sheet (2026-11-28):** 78 games (Games 40, multiplayer 3, old data 35). 75 OK, 1 to check (the multiplayer spread), 2 blocked: the hand-merged 4-player game (two seats without names; "elise" and "cody" are written beside it) and an old-data game with no score for one seat. All 39 faction spellings match through the seeded aliases plus loose matching (which now also ignores spaces around "/", for "Firmament/ Obsidian"). The Games tab's last game has the note "add data to table starting here", which the importer should clear in review. The tests run against `packages/shared/test-fixtures/ti-sample.xlsx`, a copy of the real sheet with player names replaced (Marcus → `user`, Eric → `user2`, codey → `user3`, cody → `user 3`, elise → `user4`, also inside formulas) and document properties cleared. `TI_SHEET=<path> pnpm test` runs the same checks against a fresh download.

---

## 5. Pages

| Route | Page | Contents |
|---|---|---|
| `/` | Dashboard | Recent games, top factions, top players (my roster when signed in), total games |
| `/games` | Games list | Date, winner, winning faction, player count, spread. Filter by player, faction, player count, date, "my games" |
| `/games/:id` | Game detail | Seats by points, winner, spread, notes, who logged it. Edit/delete if owner or admin |
| `/games/new`, `/games/:id/edit` | Log / edit game | Date, VP target, ended-early; 2–8 rows of player + faction + points; winner auto-selected from top score, overridable on a tie when ended early |
| `/factions`, `/factions/:id` | Factions | Win rate vs expected, games, avg points; filter by player count and expansion; detail shows trend and who plays it |
| `/players`, `/players/:id` | Players | Roster stats; detail shows faction record and history; "This is me" claim button |
| `/import` | Spreadsheet import | Flow in section 4 |
| `/account` | Account | Profile, linked player, my imports (with undo) |
| `/signin` | Auth | Enter email → enter 6-digit code (expiry set by Neon Auth). First sign-in creates the account and asks for a display name |
| `/admin` | Admin | Factions & aliases, users & roles, delete any game |

## 6. API

```
GET    /api/health               (smoke test after deploy; checks DB connectivity)

GET    /api/games?playerId=&factionId=&playerCount=&from=&to=&mine=
GET    /api/games/:id
POST   /api/games                (user)
PUT    /api/games/:id            (owner/admin)  replaces seats atomically (one HTTP transaction)
DELETE /api/games/:id            (owner/admin)

GET    /api/players?mine=        POST /api/players (user)
GET    /api/players/:id          PATCH /api/players/:id (owner/admin)
POST   /api/players/:id/claim    (user)
POST   /api/players/:id/merge    (owner/admin)  body: { intoPlayerId }
DELETE /api/players/:id          (owner/admin)  only if the player has no seats; otherwise 409

GET    /api/factions             POST/PATCH /api/factions (admin)
GET    /api/factions/:id         POST/DELETE /api/factions/aliases (admin)
GET    /api/factions/aliases     (public; used by the importer)

GET    /api/stats/factions?playerCount=&from=&to=&mine=
GET    /api/stats/players?playerCount=&from=&to=&mine=

POST   /api/imports              (user)  body: source name + first chunk (≤ 25 games); creates the batch
POST   /api/imports/:id/games    (importer)  body: next chunk (≤ 25 games)
GET    /api/imports              (user)  your own imports, with game counts
DELETE /api/imports/:id          (owner/admin)

GET    /api/me                   (user)  current app_users row; creates it on first call
PATCH  /api/me                   (user)  body: { displayName }

/api/auth/*                      proxied unchanged to Neon Auth (NEON_AUTH_BASE_URL)
```

---

## 7. Milestones (each shippable)

1. **Skeleton + deploy**: monorepo, Hono Worker + React wired, Neon + Drizzle migrations, faction + alias seed, CI, live on `*.workers.dev` with `/api/health`.
2. **Accounts** (Neon Auth): spike first (see [Auth design](#auth-design-neon-auth)), then branch config (OTP only, Google + Organization off, trusted domain), `/api/auth/*` proxy, `/signin` page, `app_users` + `/api/me`, display names, roles, admin bootstrap via `ADMIN_EMAILS`, Gmail as Neon Auth custom SMTP. Confirm proxied and session-checked requests stay under the free plan's 10 ms CPU.
3. **Log games**: roster players, game form with validation, games list + detail, owner edit/delete.
4. **Import**: shared parser + tests against the real sheet, import page, batch undo.
5. **Stats**: views, factions + players pages, dashboard, player-count filter.
6. **Admin & polish**: faction/alias management, player merge/claim, delete a player who isn't in any games (for typos and test names; players in games are archived or merged instead), mobile layout.

## 8. Out of scope for v1 (v2 candidates)
**Playgroups / shared group rosters (confirmed v2)**, objectives scored, round timing, map/seats, Elo ratings, head-to-head records, game participants (non-owners) editing.

---

## 9. Deployment ($0/month)

### Environments

| Env | App | Database | Purpose |
|---|---|---|---|
| Local | `pnpm dev`: Vite dev server proxies `/api` to `wrangler dev` (local Workers runtime) | Neon `dev` branch (free plan includes 10 branches; the serverless driver talks to Neon, not plain local Postgres) | Daily development |
| CI | GitHub Actions | Postgres service container | Typecheck, lint, tests, build |
| Production | Cloudflare Worker `mecatol-ledger` | Neon project, `production` branch (the default branch) | The live site |
| Preview *(optional, later)* | Worker preview version per PR | Neon branch per PR | Test changes and migrations against a copy of prod data |

### Services (all free plans)
- **Cloudflare Workers**: one Worker serves the built React app as static assets (free, unlimited) and handles `/api/*`. Free plan: 100,000 API requests/day and 10 ms CPU per request. It doesn't sleep, so there's no cold-start wait.
- **Neon**: permanent free Postgres, 1 GB per project, scales to zero when idle (wakes in well under a second).
- **Neon Auth**: hosts sign-in, sessions and OTP codes on the Neon branch. Free plan: up to 60,000 monthly active users per project.
- **Gmail (dedicated account, e.g. `mecatolledger@gmail.com`)**: Neon Auth's custom SMTP provider in production. Neon sends the codes; the Worker sends no email.
- **No custom domain**: the site lives at `mecatol-ledger.<account>.workers.dev`.

### CPU budget (10 ms/request on the free plan)
- No auth crypto in the Worker: Neon Auth issues and checks codes and sessions. The Worker only forwards `/api/auth/*` and asks Neon Auth for the session on writes (network wait, not CPU).
- Spreadsheet parsing runs in the browser. The server only validates and inserts the normalized JSON.
- Stats are computed in Postgres. Waiting on the database doesn't count as CPU time.
- Milestone 2 measured real CPU per route with `wrangler tail`: all routes 0–6 ms after the fix (see the spike results under "Auth design"). If something goes over, the fallback is Cloudflare's $5/month paid plan with no code changes.
- **No WebSocket `Pool`** (milestone 3, measured 2026-11-28): game writes first used a per-request WebSocket `Pool` for transactions. `POST /api/games` took **16 ms** and `PUT` 10 ms, against 0–7 ms for every HTTP-driver route, because each new Pool connection does Postgres SCRAM-SHA-256 login (thousands of hash rounds) in the Worker. Writes now go over the HTTP driver, where Neon's proxy does the login: a single statement with data-modifying CTEs (create) or `sql.transaction([...])`, a non-interactive HTTP transaction (edit). Imports follow the same pattern.

  Re-measured in production after the change (2026-11-28, `wrangler tail`, 14 requests, all `ok`, no exceptions):

  | Route | Before: game writes on the Pool (n) | After: HTTP only (n) |
  |---|---|---|
  | `POST /api/games` | **16** ms (1) | **7** ms (1) |
  | `PUT /api/games/:id` | **10** ms (1) | **5** ms (1) |
  | `DELETE /api/games/:id` | 2 ms (1) | 2 ms (1) |
  | `POST /api/players` | 2–6 ms (3) | 2–5 ms (3) |
  | `GET /api/players` | 1–2 ms (10) | 1–3 ms (5) |
  | `GET /api/games`, `/api/factions`, `/api/health` | 1–10 ms (12) | 1–4 ms (3) |

  One sample per game write, probably on a fresh isolate, so typical requests should be lower. `POST /api/games` at 7 ms is the tightest route.
- **Imports go in 25-game chunks** (milestone 4, measured 2026-11-28 with `wrangler tail`, all `ok`): importing the real sheet (76 games) in one request took **15 ms** the first time and **8 ms** the second (after an undo). Undo (`DELETE /api/imports/:id`) took 3 ms both times; other routes 1–9 ms (`GET /api/games` hit 9 ms once with 76 games listed, 2–3 ms otherwise). Zod validation of the 76 games takes under 2 ms locally, so the rest is per-request work that grows with the batch, and a 500-game import would be far over. The browser now sends `IMPORT_CHUNK_GAMES` (25) games per request: the first creates the batch, the rest go to `POST /api/imports/:id/games`.

  Re-measured with 25-game chunks (2026-11-28, 73 games, 3 requests, all `ok`): first chunk **11 ms**, then 6 and 4 ms. The chunks were the same size (~4.5 KB), so the first request's extra ~6 ms is a one-time cost of running the import code on a fresh isolate, not its games. The first chunk is now `IMPORT_FIRST_CHUNK_GAMES` (5) games and later chunks stay at 25. **To do after deploying it:** `wrangler tail` another import of the sheet and record the numbers here.

### Pipeline
1. Push or PR → **GitHub Actions**: `pnpm install`, typecheck, lint, Vitest (with a Postgres service), build.
2. Merge to `main` → the same workflow:
   1. runs `drizzle-kit migrate` against Neon,
   2. runs `wrangler deploy`,
   3. smoke-tests `/api/health`.
3. Rollback: `wrangler rollback` (or the Cloudflare dashboard) returns to the previous Worker version instantly.

Migrations are written to be **backward compatible** (add columns first, remove later), so rolling back app code never needs a database rollback.

### Configuration

Worker secrets (`wrangler secret put …`) and matching GitHub Actions secrets:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon connection string (pooled) |
| `NEON_AUTH_BASE_URL` | Neon Auth URL for the branch (from `neon deploy` / `.env.local`). Not secret, but kept with the other Worker vars |
| `ADMIN_EMAILS` | Comma-separated emails that get `admin` role |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions only: deploy permission |

### Sign-in email (no domain)
Without a domain, Resend and similar services refuse to email anyone except the account owner, so they can't be used. Neon Auth sends the codes itself:
- **Development:** Neon's shared sender (`auth@mail.myneon.app`). Rate-limited and meant for development only.
- **Production:** Neon Auth custom SMTP pointed at a **dedicated Gmail account** (`smtp.gmail.com:465`, Google app password, 2-step verification on that account). Configured on the Neon branch, not as a Worker secret:
  `neon neon-auth config email-provider update --type standard --host smtp.gmail.com --port 465 --username … --password … --sender-email … --sender-name "Mecatol Ledger"`, then `neon neon-auth config email-provider test --recipient-email …`.
- The Worker sends no email, so there is no `EmailSender` interface and no `worker-mailer`. The old open question about Gmail accepting SMTP logins from Cloudflare's network goes away; the new one is Gmail accepting them from Neon's (checked by the `test` command above). Fallback: Brevo's free plan with a verified single sender, configured the same way.

### Auth design (Neon Auth)

*Confirmed 2026-11-27. Replaces self-hosted Better Auth (Drizzle adapter, Gmail SMTP from the Worker).*

**Why:** Neon Auth is Better Auth hosted on the Neon branch. It supports the planned 6-digit email code sign-in, sends the codes, and stores users and sessions in the `neon_auth` schema. The Worker does no auth crypto and sends no email, which removes the two milestone 2 risks (10 ms CPU and Gmail SMTP from Cloudflare). Auth state also branches with the database, so a Neon `dev` or preview branch gets its own users.

**How a request flows**
1. The browser uses `@neon/auth` `createAuthClient("/api/auth", …)`: `emailOtp.sendVerificationOtp({ email, type: "sign-in" })`, then `signIn.emailOtp({ email, otp })`, `getSession()`, `signOut()`.
2. The Worker forwards `/api/auth/*` unchanged to `NEON_AUTH_BASE_URL` (a plain `fetch` pass-through, rewriting only the path). Cookies are then set on the app's own `workers.dev` origin, so they're first-party and Safari's tracking protection doesn't block them. Calling Neon Auth's own domain from the browser would make them third-party cookies.
3. Reads (games, stats) stay public and need no session.
4. On a write, Hono middleware forwards the request's cookie to Neon Auth `GET /get-session`. No session means `401`. With a session, it upserts `app_users` (id, email) and loads `role`. Admin checks use `app_users.role`, never a JWT claim.

**Neon Auth branch settings** (per branch, via `neon neon-auth …`):
- Email OTP on. Password sign-in off (`config email-password update --enabled false`), if the spike shows OTP works without it.
- Shared Google provider removed (`oauth-provider delete --provider-id google`). Organization plugin off (`config organization update --enabled false`).
- Trusted domain `https://mecatol-ledger.<account>.workers.dev`. Localhost allowed on dev branches only.
- Application name "Mecatol Ledger". Custom SMTP in production (above).

**Roles and admins:** `role` lives in the app's own `app_users` table, not in Neon Auth's Admin plugin, so permission logic, migrations and tests stay in our schema. On upsert, an email listed in `ADMIN_EMAILS` gets `role = 'admin'`. Neon's own `neon_auth.user.role` is left alone.

**Why `app_users` instead of foreign keys into `neon_auth.user`:** `neon_auth` is managed by Neon, so a foreign key into it could block Neon-side user deletion or break if Neon changes that schema. With `app_users`, Drizzle never models `neon_auth`. Neon Auth's id is `uuid`, so `app_users.id` and every `created_by` / `user_id` are `uuid`.

**Spike (first task of milestone 2, on a Neon `dev` branch):**
1. Email OTP sign-in creates a user on first use, with password sign-in and sign-up turned off. The docs don't say. If it doesn't work, leave password sign-up on, but build no password UI and set `disableSignUp`. Otherwise fall back to self-managed Better Auth.
2. The `@neon/auth` client works against the same-origin `/api/auth` proxy, and Neon Auth's `Set-Cookie` headers survive the proxy (cookie name prefix, `Secure`, no `Domain` attribute).
3. Session lifetime and OTP expiry, which the docs don't state. Record what they are.
4. CPU time of proxied and session-checked requests, measured with `wrangler tail`.

**Spike results (2026-11-27, Neon `dev` branch):**
1. ✅ Email OTP sign-in works with password sign-in **disabled** (`email_and_password` off) and creates the user on first use. No password sign-up needed.
2. ✅ The `@neon/auth` client works against the same-origin `/api/auth` proxy (it needs an absolute URL, so the app passes `${location.origin}/api/auth`). Neon Auth sets `__Secure-neon-auth.session_token` with `HttpOnly; Secure; SameSite=None; Partitioned; Path=/` and no `Domain`, so it lands on the app's origin unchanged. Works on `http://localhost` in Chromium.
3. Session lifetime **7 days** (`Max-Age=604800`, refreshed by `get-session`). OTP expiry **10 minutes**. A wrong code returns `400 {"code":"INVALID_OTP"}`.
4. ✅ CPU per request, measured in production with `wrangler tail` (2026-11-27):

   | Route | First deploy (n) | After fix (n) |
   |---|---|---|
   | `/api/auth/*` (proxied) | 0–3 ms (13) | 0–3 ms (17) |
   | `/api/me` signed out (401) | 0–4 ms (8) | 0–3 ms (15) |
   | `/api/me` signed in | 3 / 6 / **14** ms (6) | 0 / 1 / 6 ms (37), p90 5 ms |

   Signed-in requests first went over the 10 ms limit. The fix: the `app_users` upsert is plain SQL instead of a Drizzle-built query, and `requireUser` keeps each user's row in memory per isolate for 60 s, so repeat requests skip the write. The session is still checked with Neon Auth on every request. Remaining cost is the session check (one `fetch` plus parsing its reply). New routes that run `requireUser` should be measured the same way.
- Neon's shared dev sender sometimes delays a code by a minute or more; "Resend code" helps. Production uses custom SMTP.
- `@neon/auth` 0.8.2 pins `@better-fetch/fetch@1.3.2`; a pnpm override to 1.3.3 keeps one copy of `@better-auth/core` (two copies break the client's `emailOtp` types).

**Fallback:** if the cookie proxy fails, the browser sends Neon Auth's 15-minute JWT as `Authorization: Bearer`, and the Worker verifies it with `jose` against `NEON_AUTH_JWKS_URL` (EdDSA, `iss`/`aud` = the auth URL's origin). That check is cheap and native in Workers.

**Production checklist:** custom SMTP, trusted domain, application name, Google provider removed, "Allow Localhost" off on the production branch.

### Backups
Neon keeps point-in-time restore history (window depends on plan). As an extra safety net: a weekly GitHub Actions job runs `pg_dump` and stores the dump as a workflow artifact, plus an admin "Export CSV" button.

---

## 10. Name

**Mecatol Ledger.** Repo `mecatol-ledger`.

Keep "Twilight Imperium" out of the name and domain (Fantasy Flight Games' trademark); reference it in the tagline instead: "A stats tracker for Twilight Imperium games." No custom domain for v1: the site runs at `mecatol-ledger.<account>.workers.dev`.

---

## Decision log
- 2026-11-26: Frontend React. Users have their own accounts; admin role for factions and permanent data.
- 2026-11-26: Factions: base + Prophecy of Kings + Thunder's Edge (+ Council Keleres, present in existing data).
- 2026-11-26: Point spread = 1st − 2nd. Games ended early use the `ended_early` flag.
- 2026-11-26: Shared playgroup rosters deferred to v2.
- 2026-11-26: Undated games in the existing spreadsheet are 2026.
- 2026-11-26: Firmament / Obsidian stays one faction.
- 2026-11-26: Name: **Mecatol Ledger**. Repo at `/Users/cherberholz/WebstormProjects/mecatol-ledger`.
- 2026-11-26: Hosting must be free. Streamlit ruled out (Python rewrite, apps sleep, poor fit for accounts and editing). Render free ruled out (sleeps after 15 min idle).
- 2026-11-26: Hosting: **Cloudflare Workers (free) + Neon (free)**; CI/CD on GitHub Actions. Backend framework changed from Fastify to **Hono**.
- 2026-11-26: Sign-in is **passwordless, email code only** (no Discord/Google). Avoids password hashing, which would exceed the free plan's 10 ms CPU limit.
- 2026-11-26: **No custom domain**; site on `workers.dev`. Sign-in emails go through a dedicated Gmail account over SMTP because Resend requires a verified domain.
- 2026-11-27: Auth moves to **Neon Auth** (managed Better Auth), still email-code only. Neon sends the codes (Gmail as its custom SMTP in production). New `app_users` table; user columns become `uuid references app_users(id)`. See [Auth design](#auth-design-neon-auth).
- 2026-11-28: Database writes use Neon's **HTTP driver only** (single statements or HTTP transactions). The WebSocket `Pool` took game writes over the 10 ms CPU limit.
- 2026-11-28: Milestone 4 (import): SheetJS from its CDN tarball, behind a separate `@mecatol/shared/xlsx` entry. "No date" is info, not a warning. Imports may use archived players and factions. Players an import creates stay after an undo (deleting unused players is milestone 6). `POST /api/factions/aliases` added now for the importer; alias deletion stays in milestone 6.
- 2026-11-28: Imports are sent in **25-game chunks** (`POST /api/imports`, then `POST /api/imports/:id/games`). The sheet in one request took 8–15 ms CPU against the 10 ms limit. A failed chunk makes the browser undo the batch. No schema change.
- 2026-11-28: An import's **first chunk is 5 games**: the first request on a fresh isolate pays ~6 ms of one-time cost (a 25-game first chunk took 11 ms).

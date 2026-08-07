# Project Status — Email Manager v2

_Last updated: 2026-08-06_

## Current snapshot

| What | Where |
|---|---|
| V1 code (Python, tagged) | `git checkout v1-python` to return |
| V2 architecture diagram | `docs/architecture_v3.excalidraw` |
| V2 requirements | `docs/PRD.md` |
| Agent rules | Root `AGENTS.md` |
| Tracking files | `project/` (status, todo, lessons, decisions) — committed |
| V2 code | `backend/` — NestJS 11, Prisma 7, CI/CD wired, deployed on Heroku |
| Branch | `dev` (active, merged PRs #1–#14) |
| Deploy | https://email-manager-a30f36867c98.herokuapp.com/api/health — up, `web.1` running since 2026-08-06 11:07 (release v33), webhook confirmed responding (`/start` processed) |
| Tests | 63 pass (7 suites), build+typecheck+lint clean |
| Tag | `v1-python` — marks Python v1, pushed to origin |
| Infra | Heroku app `email-manager` + Heroku Postgres (`essential-0`, RDS-backed), CI deploys on push to `dev` |

## Sessions

### [2026-08-06 #7] — Diagnosed and fixed `prisma migrate deploy` P1001 blocking Heroku release phase

**Done:**
- Diagnosed why production was still crash-looping on old code 30+ hours after the
  `tracer.js` boot-crash fix (PR #13) merged to `dev`: the Heroku release phase
  (`prisma migrate deploy`) was failing with `P1001` on every deploy attempt, so Heroku
  never promoted the new slug — the dyno kept serving stale, pre-fix code.
- Ruled out DB health, network/security-group reachability, and `sslmode` value via
  layered testing from inside real Heroku one-off dynos: raw TCP succeeded, a full
  TLS+Postgres handshake via `node-postgres` succeeded, but Prisma's own migrate engine
  failed identically regardless of `sslmode`. Isolated the bug to Prisma's classic
  schema-engine (used only by `migrate deploy`, separate from the app's runtime
  `@prisma/adapter-pg` client).
- First attempt (wiring an `adapter()` into `prisma.config.ts`) turned out to be dead
  code — Prisma 7 removed adapter support from the CLI config entirely (confirmed by
  reading the installed package's compiled JS/`.d.ts`, not just docs). Second attempt
  (a custom `pg`-based migration runner script) worked but was scrapped once a cheaper
  test — `npx prisma@latest migrate status` against production — proved the bug was
  already fixed upstream in 7.9.1. See `project/lessons.md` [2026-08-06].
- Fix: bumped `prisma`, `@prisma/client`, `@prisma/adapter-pg` from `^7.7.0` to
  `^7.9.1` in `backend/package.json`. No workaround code, no config changes.
- PR #14 merged to `dev` (2026-08-06 09:46 UTC). Heroku release v32 (code deploy)
  succeeded — release phase passed for the first time since 2026-08-04. `web.1` came
  back up; webhook confirmed responding (`/start` processed end-to-end in prod logs).
- Follow-on fix, same session: Datadog APM traces were being dropped with `403
  Forbidden` (agent defaults to the US1 site; this Datadog org is on US5). Fixed with
  `heroku config:set DD_SITE=us5.datadoghq.com` (release v33, also succeeded).
- Created a new global skill, `~/.claude/skills/research-before-workaround/SKILL.md`
  (applies to all projects, not just this repo), codifying the lesson below: check for
  a known/already-fixed upstream issue (newer version, docs, GitHub issues) before
  writing custom workaround code.

**Decisions locked:**
- Don't build custom tooling around a library bug before testing whether a newer
  version already fixes it — now enforced by the `research-before-workaround` skill.
- Datadog Heroku buildpack requires `DD_SITE` set explicitly for any non-US1 org;
  it silently defaults to `datadoghq.com` otherwise (no error until traces get 403'd).

**Next up:**
- Nothing pending on this incident — closed. Local branch
  `fix/backend/prisma-migrate-adapter` can be deleted (merged); switch back to `dev`.
- Resume Phase 4 backlog: `/disconnect`, `/search`, `/write`, `/summary` (see
  `project/todo.md`).

### [2026-07-27 #6] — ULID PK migration + /connect OAuth flow (Phases 4: /connect)

**Done:**
- **ULID PK migration**: Removed `@default(cuid())` from all models, installed `ulid`, added ULID generation in `UserService.create()`, added `@@unique([userId, provider])` + `updatedAt` on `Connection` model. Migration applied via `prisma db push`. Seed file updated.
- **OAuth env validation**: Added `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` to `validateEnv()`.
- **OAuth URL helper** (`common/helpers/oauth-url.ts`): Pure function `buildGoogleOAuthUrl(state)` — constructs Google OAuth consent URL with `access_type=offline` + `prompt=consent` for refresh tokens. Uses `URLSearchParams`. Throws if config missing.
- **OAuth callback DTO** (`oauth/dto/google-callback.dto.ts`): `GoogleCallbackDto` with `@IsString()` on `code` and `state`.
- **ConnectionService** (real): Injects `PrismaService` + `EncryptionHelper`. `storeTokens()` finds user by `telegramChatId`, encrypts both tokens, upserts on `(userId, provider)` with ULID. `getTokens()` decrypts and returns tokens. `deleteTokens()` removes connection. All throw `NotFoundException` when user missing.
- **OAuthService** (real): `handleCallback(code, state)` creates Google OAuth2 client, exchanges code for tokens, fetches userinfo, stores via `ConnectionService`, sends Telegram confirmation. No `getAuthUrl()` removed — URL lives in the pure helper.
- **OAuthController**: Browser-facing `GET /oauth/google/callback` validates via `GoogleCallbackDto`, delegates to service, returns HTML success/error page via `@Res()` (bypasses JSON interceptor for browser context).
- **Telegram `/connect` handler**: `handleConnect(chatId)` imports `buildGoogleOAuthUrl()` pure function (no DI, no circular dep), sends URL with chatId in `state` param. Catches config errors → sends user-friendly error message.
- **Module wiring**: Zero circular dependencies. `OAuthModule` imports `ConnectionModule` + `TelegramModule` (one-way). `TelegramModule` unchanged — does not import `OAuthModule`.
- **Tests**: 23 new tests across 3 new suites + 3 extended. Total: 57 tests (6 suites).
  - `oauth-url.spec.ts` (8 tests): URL structure, env vars, missing config.
  - `connection.service.spec.ts` (7 tests): encrypt/upsert, reconnect, user-not-found, decrypt, null connection, delete.
  - `oauth.service.spec.ts` (4 tests): code exchange + store + notify, missing access_token, Google error, missing refresh_token.
  - `telegram.service.spec.ts` extended (3 tests): /connect sends URL, state=chatId, config-missing error.

**Decisions locked:**
- OAuth URL is a pure helper function, not a service method — avoids circular `forwardRef`.
- OAuth callback returns HTML via `@Res()` (bypasses JSON interceptor).
- All PKs are now ULIDs, generated in application code with `ulid()`.
- `Connection` model has `@@unique([userId, provider])` — upserts on reconnect.

**Next up:**
- Deploy to Heroku with OAuth env vars
- Implement `/disconnect`

### [2026-07-24 #5] — Core flows (Plans 1–4) + Heroku SSL fix + config validation + class-validator DTOs

**Done:**
- **Plan 1 — UserService** (`user.service.ts`, `user.service.spec.ts`): Prisma-backed `findByChatId`, `findById`, `create`. 6 tests.
- **Plan 2 — EncryptionHelper** (`encryption.ts`, `encryption.spec.ts`): AES-256-GCM with IV + auth tag, validated key, registered in PrismaModule. 14 tests.
- **Plan 3 — Telegram outbound** (`telegram.service.ts`, `telegram.service.spec.ts`): `sendMessage()` with MarkdownV2 fallback, `sendTyping()`. 8 tests.
- **Plan 4 — Command handler** (`telegram.service.ts`, `telegram.module.ts`, `dto/telegram-update.dto.ts`): `/start` (create/welcome), `/help`. 6 tests merged into Plan 3 suite (14 total).
- **Plan A — Config validation** (`config/env.ts`, `app.module.ts`): `validateEnv()` checks required vars at startup; `ENCRYPTION_KEY` error message fixed to show `openssl rand -hex 32`.
- **Plan B — class-validator DTOs** (`dto/telegram-update.dto.ts`, `main.ts`, `telegram.controller.ts`): Interfaces → classes with `@IsString()`, `@ValidateNested()`, etc. Global `ValidationPipe` with whitelist + transform.
- **Heroku SSL fix** (`prisma.service.ts`): Added `?sslmode=no-verify` to `DATABASE_URL` when not present — fixes `TlsConnectionError` on Heroku Postgres. PR #8 pending merge.
- **Webhook script** (`scripts/set-webhook.sh`): `npm run webhook:set` (local from `.env`) / `npm run webhook:set:prod` (Heroku via `heroku config:get`).

**Decisions locked:**
- Jest ESM config: `NODE_OPTIONS=--experimental-vm-modules`, `useESM: true` in ts-jest, `moduleNameMapper` for `.js` imports.
- DTOs must be classes with `class-validator` decorators (not interfaces).
- Config validation via `validateEnv()` function passed to `ConfigModule.forRoot({ validate })`.
- Heroku Postgres SSL: `?sslmode=no-verify` in connection string.

**Current state:**
- Branch: `dev` (PR #8 merged)
- 57 tests pass (6 suites), build+typecheck+lint clean
- `/start`, `/help`, and `/connect` work end-to-end (needs Heroku deploy with OAuth env vars)

**Next up:**
- Deploy to Heroku with `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` set
- Test `/connect` end-to-end in production
- Then implement `/disconnect`, `/search`, `/write`, `/summary`

### [2026-07-22 #3] — Heroku deploy fixes: Prisma generate, lockfile, @emnapi pinning

**Done:**
- Added `postinstall: npx prisma generate` to package.json — generated client was gitignored and missing on Heroku deploy
- Pinned `@emnapi/core@1.10.0` + `@emnapi/runtime@1.10.0` as explicit devDeps — lockfile kept desyncing on CI
- Deployed successfully: health endpoint returns `{ success: true, data: { status: "ok" } }`
- Updated `.env` with production Heroku URL

**Decisions locked:**
- PrismaClient import: never from `@prisma/client`, always from `../generated/prisma/client.js`
- Generated client is gitignored; `postinstall` hook generates it at build time
- `engines.node: "24.x"` and `engines.npm: "11.x"` in package.json for deterministic builds

### [2026-07-22 #1–#2] — NestJS scaffold + Prisma 7 migration + CI setup

**Done:**
- Scaffolded NestJS 11 with SWC, strict TS, nodenext ESM
- Structure: src/common, src/config, src/core (7 modules), src/prisma, src/generated/prisma
- Prisma 7 schema (User, Connection, EmailPreference) + migration + seed
- `@prisma/adapter-pg` + `pg` for PostgreSQL adapter
- ESM fix: PrismaClient generated as TypeScript into `src/generated/prisma/`
- GitHub Actions deploy CI workflow for dev branch (lint, typecheck, test, build, deploy)
- Created `dev` branch; Heroku deploy on push to dev
- Lockfile regenerated; `npm ci` switch in CI

**Next up:**
Module implementation — Telegram webhook handler, then `/start` and `/connect` flows.

### [2026-07-20 #3] — Tag, push, handoff

**Done:**
- Tagged `main` as `v1-python` — returnable Python checkpoint
- Pushed commit + tag to `origin/main`
- Final handoff: project ready for NestJS scaffold

### [2026-07-20 #2] — Commit phase 0

**Done:**
- Committed `489e1f7 chore(phase0)` — AGENTS.md, PRD.md, architecture_v3.excalidraw, .gitignore

### [2026-07-20 #1] — Architecture, requirements, rules, infra setup

**Done:**
- V3 architecture diagram, PRD.md, AGENTS.md, tracking files
- Heroku app + Postgres provisioned
- Folder structure and naming conventions locked

**Decisions locked (cumulative):**
- Branch prefix: `backend/feat/*`, `backend/fix/*`, `backend/refactor/*`
- ESM `.js` imports — Node.js requirement
- No Telegraf — raw `fetch()` for Telegram
- Heroku Postgres (provisioned), not Neon
- CI deploys on push to `dev`
- `dev` branch created from `main` after initial scaffold push
- PrismaClient import: never from `@prisma/client`, always from generated `../generated/prisma/client.js`

## Tech Stack

NestJS 11 + TypeScript 5.7 (`nodenext`, ESM) + Prisma 7 + PostgreSQL + Heroku

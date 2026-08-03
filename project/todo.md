# Todo — Email Manager v2

## Phase 0: Planning (session 2026-07-20)

- [x] Architecture diagram v3
- [x] PRD with stack, structure, deployment, conventions
- [x] AGENTS.md with branch/commit/code rules
- [x] Tracking files (status, lessons, todo)
- [x] Heroku app + Postgres provisioned
- [x] Docs folder cleaned

## Phase 1: Scaffold (session 2026-07-22)

- [x] NestJS CLI init `backend/` with SWC
- [x] Install deps: config, schedule, prisma, googleapis, groq-sdk, class-validator, passport-jwt
- [x] Set up `tsconfig.json` with `strict`, `nodenext`, ESM
- [x] ESLint 9 + Prettier config
- [x] `docker-compose.yaml` for local PostgreSQL
- [x] Prisma init: `schema.prisma` (User, Connection, EmailPreference)
- [x] Prisma migration + seed
- [x] Prisma 7 migration with `@prisma/adapter-pg`
- [x] ESM fix: PrismaClient generated as TS into `src/generated/prisma/`
- [x] CI deploy workflow (lint, typecheck, test, build, deploy to Heroku)
- [x] Heroku deploy working (health endpoint green)

## Phase 2: Module Skeletons (session 2026-07-22)

- [x] `PrismaModule` + `PrismaService` (src/prisma/)
- [x] `ConfigModule` with env validation (src/config/) — done, now has `validateEnv()`
- [x] `TelegramModule` — controller, service (webhook + command handler wired)
- [x] `UserModule` — service (Prisma-backed)
- [x] `ConnectionModule` — service (skeleton)
- [x] `OAuthModule` — controller, service (skeleton)
- [x] `GmailModule` — service (skeleton)
- [x] `AIModule` — service (skeleton)
- [x] `SchedulerModule` — service (@Cron) (skeleton)

## Phase 3: Common Layer (session 2026-07-22)

- [x] `ApiResponseInterceptor` — { success, data, meta } envelope
- [x] `TelegramWebhookGuard` — verify X-Telegram-Bot-Api-Secret-Token
- [x] `EncryptionHelper` — AES-256-GCM with IV + auth tag
- [x] Global `ValidationPipe` — whitelist + transform enabled
- [x] Config validation — `validateEnv()` checks required vars at startup
- [x] ULID PK migration (2026-07-27) — removed @default(cuid()), installed `ulid`, updated UserService + seed
- [ ] Shared DTOs (pagination, error responses)

## Phase 4: Core Flows

- [x] `/start` — register or welcome user via UserService
- [x] `/help` — command list
- [x] Telegram outbound — `sendMessage()` with MarkdownV2 fallback, `sendTyping()`
- [x] `/connect` — OAuth URL + callback + token store (2026-07-27)
- [ ] `/disconnect` — revoke + delete tokens
- [ ] `/search` — Gmail API query
- [ ] `/write` — Gmail API send
- [ ] `/summary` — AI classify + summarize
- [ ] Scheduler monitoring loop

## Phase 5: Polish

- [ ] Rate limiting (@nestjs/throttler)
- [ ] Error handling (Gmail quota, Groq failures, token expiry)
- [ ] Typing indicator during long ops
- [x] Heroku SSL fix — `sslmode=no-verify` (PR #8 merged)
- [x] Webhook script — `npm run webhook:set` / `npm run webhook:set:prod`
- [ ] Deploy OAuth env vars to Heroku (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`)

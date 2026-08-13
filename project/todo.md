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
- [x] `/list` — list connected Gmail accounts (multi-account)
- [x] `/disconnect` — revoke + delete tokens (multi-account, revoke with Google)

### Phase 4b: AI tool-calling agent (2026-08-12, see `project/decisions/001-ai-tool-calling-agent.md`)

Replaces the planned deterministic `/search`, `/write`, `/summary` handlers. Free-text
messages (any message that isn't `/start`, `/help`, `/connect`, `/list`,
`/disconnect`, `/switch`) route to an agent that decides which Gmail tool to call.

- [ ] `GmailService.searchEmails()` — real Gmail API query, lightweight result shape
- [ ] `GmailService.getUnreadEmails()` — real Gmail API fetch, lightweight result shape
- [ ] `GmailService.getEmail()` — real Gmail API full-body fetch, truncated for context
- [ ] `GmailService.createDraft()` — new, Gmail API `drafts.create` (no send)
- [ ] `AiService` — Groq client wrapper, tool schema registry, dispatch map (no
      `email` arg on any tool — account already resolved before the loop starts)
- [ ] `AiService` — agent loop: system prompt → tool_calls → execute → loop →
      stop on no-tool-calls or 4-round cap
- [ ] `AiService` — Groq → Gemini fallback chain (OpenAI-compat endpoint), each with
      an explicit stop condition
- [ ] `GEMINI_API_KEY` — add to `validateEnv()` required vars
- [ ] `TelegramService.processUpdate()` — resolve `getActive(chatId)` first, then
      route free text to `AiService` with the resolved account's tokens; keep the 6
      account-management commands deterministic
- [ ] Confirm current Gemini free-tier flash model name + RPM/TPM/RPD in AI Studio
      dashboard (not from memory)
- [ ] Manual eval: handful of test prompts run against both providers, sanity-check
      tool-selection accuracy before trusting the fallback
- [ ] Tests — tool dispatch, agent loop stop conditions, fallback chain
- [ ] Scheduler monitoring loop — classify + summarize unread emails directly via
      `AiService` for **every** connection per user (ignores `activeConnectionId`
      entirely — no tool-picking loop, no free-text input to route)

### Phase 4c: Active-account model (2026-08-12, see `project/decisions/002-active-account-switch.md`)

Mirrors `gh auth switch`. One Gmail account is "active" per user for interactive use
only — never scopes the scheduler, which always covers every connected account.

- [ ] Prisma migration — `activeConnectionId String?` on `User`, FK to `Connection`,
      `onDelete: SetNull`
- [ ] `ConnectionService.getActive(chatId)` — resolution rules per decision 002
      (0/1/>1 connections, self-healing on null pointer)
- [ ] `ConnectionService.setActive(chatId, email?)` — switched/ambiguous result,
      mirrors `disconnect()`'s discriminated union
- [ ] `ConnectionService.storeTokens()` — auto-activate the newly connected account
- [ ] `ConnectionService.disconnect()` — fix-up logic: reassign or clear
      `activeConnectionId` when the active connection is removed
- [ ] `ConnectionService.getTokens()` → rename/refactor to `getActiveTokens(chatId)`,
      resolving via `getActive()` instead of the current `.find()` first-match bug
- [ ] `/switch` command in `TelegramService` — same tier as `/connect`/`/list`/
      `/disconnect`; bare `/switch` always shows the account list when >1 exist, no
      toggle shortcut at exactly 2
- [ ] `/help` and `/start` welcome text — add `/switch` to the command list
- [ ] Tests — getActive/setActive resolution rules, storeTokens auto-activation,
      disconnect fix-up (0/1/>1 remaining), /switch command handler

## Phase 5: Polish

- [ ] Rate limiting (@nestjs/throttler)
- [ ] Error handling (Gmail quota, Groq failures, token expiry)
- [ ] Typing indicator during long ops
- [x] Heroku SSL fix — `sslmode=no-verify` (PR #8 merged)
- [x] Webhook script — `npm run webhook:set` / `npm run webhook:set:prod`
- [x] Deploy OAuth env vars to Heroku (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`)

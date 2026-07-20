# PRD: Email Manager v2 — Multi-user Telegram Bot

---

## 1. Product Summary

A Telegram bot that lets multiple users connect their Gmail accounts via OAuth, then search, read, send emails, and receive AI-powered summaries — all from Telegram. Runs as a persistent server with a built-in scheduler for passive email monitoring.

---

## 2. Core User Flows

### 2.1 Account Linking
- User sends `/start` → bot registers user in database
- User sends `/connect` → bot returns a Google OAuth authorization URL
- User approves in browser → Google redirects back with auth code
- Server exchanges code for access + refresh tokens, stores encrypted in DB
- Bot confirms: "Gmail connected"

### 2.2 Email Search
- User sends `/search from:recruiter interview` → bot searches Gmail via API
- Returns matching emails as Telegram messages with sender, subject, date
- Supports full Gmail query syntax

### 2.3 Email Writing
- User sends `/write to:john@example.com subject:Hello body:Just checking in`
- Bot sends email via Gmail API using user's OAuth token
- Confirms delivery

### 2.4 AI Summary
- User sends `/summary` → bot fetches recent unread emails
- AI classifies and summarizes (urgent / important / normal / ignore)
- Returns formatted summary card

### 2.5 Passive Monitoring (Scheduler)
- Server-side timer triggers every N hours per user (configurable)
- Fetches unread emails via Gmail API with stored OAuth tokens
- AI classifies each email into 4 categories
- Sends summary to user's Telegram chat
- Users who opt out or have no connection are skipped

### 2.6 Account Disconnection
- User sends `/disconnect` → bot deletes stored tokens
- Confirms: "Gmail disconnected"

---

## 3. Functional Requirements

### 3.1 Telegram Bot
| ID | Requirement |
|---|---|
| FR-TG-01 | Commands: `/start`, `/connect`, `/disconnect`, `/search`, `/write`, `/summary`, `/help` |
| FR-TG-02 | `/search` and `/write` accept natural language + structured params |
| FR-TG-03 | Responses formatted as Markdown (bold, separators, sections) |
| FR-TG-04 | Fallback: strip Markdown if parse error on send |
| FR-TG-05 | Inline keyboard buttons where appropriate (Read / Archive / Reply) |
| FR-TG-06 | Typing indicator sent during long operations (Gmail fetch, AI call) |

### 3.2 Google OAuth
| ID | Requirement |
|---|---|
| FR-OA-01 | Generate per-user Google OAuth authorization URL (offline access) |
| FR-OA-02 | Handle OAuth callback, exchange code for tokens |
| FR-OA-03 | Store access_token + refresh_token encrypted at rest |
| FR-OA-04 | Auto-refresh tokens before expiry (transparent to user) |
| FR-OA-05 | Revoke access on `/disconnect` |

### 3.3 Gmail Integration
| ID | Requirement |
|---|---|
| FR-GM-01 | Use Gmail REST API (not IMAP) for all operations |
| FR-GM-02 | Per-user OAuth token — no shared credentials |
| FR-GM-03 | `listEmails(opts)` — lightweight metadata fetch (monitoring) |
| FR-GM-04 | `searchEmails(query)` — full-text Gmail query syntax (`/search`) |
| FR-GM-05 | `getEmail(id)` — full body + attachments (`/read`) |
| FR-GM-06 | `sendEmail(opts)` — compose and send (`/write`) |
| FR-GM-07 | `getUnreadEmails()` — shortcut for monitoring flow |

### 3.4 AI Classification
| ID | Requirement |
|---|---|
| FR-AI-01 | Classify each email: urgent / important / normal / ignore |
| FR-AI-02 | Summarize multiple emails into a single digest |
| FR-AI-03 | Answer natural language questions about user's emails |
| FR-AI-04 | Generate draft replies |
| FR-AI-05 | Extract search intent from natural language |
| FR-AI-06 | Use Groq API (Llama 3.3 70B Versatile) — free tier |
| FR-AI-07 | Local filter runs first (spam, automated, always-ignore) to save API calls |
| FR-AI-08 | Fallback to keyword-based classification if AI unavailable |

### 3.5 Passive Monitoring
| ID | Requirement |
|---|---|
| FR-PM-01 | Server-side scheduler (cron-like, no external CI dependency) |
| FR-PM-02 | Iterate all users with `aiEnabled = true` and valid OAuth connection |
| FR-PM-03 | Check interval per user (from EmailPreference table) |
| FR-PM-04 | Skip users whose last check was < checkIntervalHours ago |
| FR-PM-05 | Fetch unread emails since last check |
| FR-PM-06 | Classify, summarize, send to user's Telegram chat |

### 3.6 Telegram Messaging
| ID | Requirement |
|---|---|
| FR-TS-01 | `sendMessage(chatId, text)` — basic message |
| FR-TS-02 | `sendSummaryCard(chatId, data)` — formatted email summary |
| FR-TS-03 | `sendTyping(chatId)` — typing indicator (UX) |
| FR-TS-04 | `sendError(chatId, err)` — user-facing error messages |
| FR-TS-05 | `sendInlineKeyboard(chatId, btns)` — action buttons |
| FR-TS-06 | Support MarkdownV2 parse mode |

---

## 4. Data Model

### 4.1 User
```
id              UUID        PK
telegramChatId  string      UNIQUE
createdAt       timestamp
updatedAt       timestamp
```

### 4.2 Connection
```
id              UUID        PK
userId          UUID        FK → User
provider        string      "google"
providerUserId  string      Google account ID
accessToken     string      ENCRYPTED at rest
refreshToken    string      ENCRYPTED at rest
expiresAt       timestamp
createdAt       timestamp
```

### 4.3 EmailPreference
```
id                  UUID        PK
userId              UUID        FK → User
checkIntervalHours  int         default: 4
defaultInbox        string      default: "PRIMARY"
aiEnabled           boolean     default: true
aiModel             enum        "gemini" | "groq"
notificationStyle   enum        "compact" | "detailed" | "cards" | "raw"
```

**notificationStyle values:**
- `compact` — 1-line: "3 urgent, 5 important, 12 ignored"
- `detailed` — sender, subject, reason, attachment flag per email
- `cards` — one Telegram msg per email with inline buttons (Read|Archive|Reply)
- `raw` — forward body as-is, no AI

---

## 5. Tech Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 22+ (ESM, `"type": "module"`) |
| Framework | NestJS 11 |
| Language | TypeScript 5.7+ (strict mode, `nodenext` resolution) |
| ORM | Prisma 7 |
| Database | PostgreSQL (local dev via Docker, prod via Heroku Postgres) |
| Build | SWC (fast compilation) |
| Telegram inbound | Webhook endpoint in NestJS controller |
| Telegram outbound | Raw `fetch()` to Telegram Bot API (no framework) |
| Scheduler | `@nestjs/schedule` (`@Cron()` decorator) |
| Google APIs | `googleapis` npm package (OAuth2 client + Gmail) |
| AI | `groq-sdk` npm package |
| Auth | JWT via `@nestjs/jwt` + `@nestjs/passport` |
| Validation | `class-validator` + `class-transformer` |
| Token encryption | AES-256-GCM with server-held key (env var `ENCRYPTION_KEY`) |
| Secrets | `.env` file, `@nestjs/config` |
| Deployment | Heroku Eco dyno ($5/mo) + Heroku Postgres essential-0 ($5/mo) |
| CI/CD | GitHub Actions — lint → typecheck → test → deploy on push/merge to `dev` |

## 6. Project Folder Structure

Inspired by the nabi NestJS backend. One `backend/` folder at project root.

```
backend/
├── .env.example
├── .env                        # gitignored
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── nest-cli.json
├── eslint.config.mjs
├── .prettierrc
├── Dockerfile
├── docker-compose.yaml         # local PostgreSQL
│
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts                 # idempotent seed
│
├── src/
│   ├── main.ts                 # bootstrap
│   ├── app.module.ts           # root module
│   ├── app.controller.ts       # health check
│   │
│   ├── common/                 # cross-cutting
│   │   ├── decorators/
│   │   ├── filters/
│   │   ├── guards/
│   │   │   └── telegram/       # validates Telegram webhook signature
│   │   ├── interceptors/
│   │   │   └── response/       # standardized { success, data, meta } envelope
│   │   ├── dtos/
│   │   │   └── pagination.dto.ts
│   │   └── helpers/
│   │       └── encryption.ts   # AES encrypt / decrypt
│   │
│   ├── config/
│   │   └── env.ts              # validated env vars via Joi or zod
│   │
│   ├── core/                   # business modules
│   │   ├── telegram/
│   │   │   ├── telegram.module.ts
│   │   │   ├── telegram.controller.ts   # POST /webhook
│   │   │   ├── telegram.service.ts      # parse, dispatch, send outbound
│   │   │   ├── command-parser.service.ts
│   │   │   └── dto/
│   │   │
│   │   ├── oauth/
│   │   │   ├── oauth.module.ts
│   │   │   ├── oauth.controller.ts      # GET /oauth/google, GET /oauth/google/callback
│   │   │   └── oauth.service.ts
│   │   │
│   │   ├── gmail/
│   │   │   ├── gmail.module.ts
│   │   │   └── gmail.service.ts
│   │   │
│   │   ├── ai/
│   │   │   ├── ai.module.ts
│   │   │   └── ai.service.ts
│   │   │
│   │   ├── user/
│   │   │   ├── user.module.ts
│   │   │   └── user.service.ts
│   │   │
│   │   ├── connection/
│   │   │   ├── connection.module.ts
│   │   │   └── connection.service.ts
│   │   │
│   │   └── scheduler/
│   │       ├── scheduler.module.ts
│   │       └── scheduler.service.ts    # @Cron() monitoring loop
│   │
│   └── prisma/
│       ├── prisma.module.ts
│       └── prisma.service.ts           # onModuleInit, encryption extension
│
└── test/
    └── e2e/
        └── telegram-webhook.e2e-spec.ts
```

### Naming conventions (per module)

```
*.module.ts      — NestJS module
*.controller.ts  — NestJS controller (routes)
*.service.ts     — business logic
*.guard.ts       — auth / validation guard
*.interceptor.ts  — response wrapping
*.dto.ts         — request/response shapes (class-validator)
dto/             — subfolder for multiple DTOs
*.spec.ts        — unit test (colocated)
```

### Module dependency graph

```
TelegramModule
  → UserModule          (lookup user by chatId)
  → OAuthModule         (/connect)
  → GmailModule         (/search, /write)
  → AIModule            (/summary)

SchedulerModule
  → UserModule          (get users needing check)
  → ConnectionModule    (get OAuth tokens)
  → GmailModule         (fetch unread)
  → AIModule            (classify)
  → TelegramService     (send summary)
```

No circular dependencies. TelegramService is injected into SchedulerModule but owned by TelegramModule.

## 7. Architecture Constraints

| Constraint | Decision |
|---|---|
| PK strategy | ULID for all primary keys (Prisma `@id` with cuid2 or manual) |
| Response envelope | `{ success: boolean, data: T, meta?: object }` on every endpoint |
| ESM imports | `import { X } from './x.service.js'` — `.js` extension for `.ts` files |
| Telegram webhook | Signature verification via `X-Telegram-Bot-Api-Secret-Token` header |
| Outbound Telegram | Raw `fetch()`, no framework — same conclusion as v1 analysis |
| Scheduler idempotency | Skip if last check was < interval ago. Never double-fetch. |
| AI fallback | Groq unavailable → keyword-based classification (same as v1) |
| OAuth token encryption | AES-256-GCM. Key from env. Never plaintext in DB or logs. |
| Infra | No Redis, no queue, no BullMQ, no WebSocket — single process for MVP |

## 8. Git & Branch Conventions

Rules adapted from the nabi project CLAUDE.md.

### Branches

```
main                        — production (deploy on push)
dev                         — integration branch
backend/feat/*              — features (backend only)
backend/fix/*               — bug fixes
backend/refactor/*          — refactors
```

All branches off `dev`, PR back into `dev`. The `backend/` prefix keeps the branch tree organized — v1 scripts at root are never touched. One branch = one logical change.

### Commit format

```
type(scope): subject (imperative, lowercase, ≤60 chars)

- what changed and why, not how (bullet points)
- one bullet = one logical change
- max 3 bullets
```

| Type | Usage |
|---|---|
| `feat` | new feature |
| `fix` | bug fix |
| `refactor` | restructuring without behavior change |
| `chore` | CI, deps, tooling |
| `docs` | documentation only |

**Never:** `feature`, `add`, `update`, `wip`. Never `Co-authored-by` trailers.

### MR format

```
### Purpose
[what this branch delivers, 2-3 sentences]

### New Endpoints
| Method | Route | Description |

### Main Changes
- [what changed and why]

### Notes
- Env vars required (if any)
- Out of scope
- Known post-MVP items deferred
```

### Never commit without explicit approval.

## 9. Deployment

| Layer | Service | Cost |
|---|---|---|
| Compute | Heroku Eco dyno (512MB, always-on) | $5/mo |
| Database | Heroku Postgres essential-0 | $5/mo |
| CI/CD | GitHub Actions | $0/mo |
| **Total** | (Heroku credits cover both) | **$0/mo** |

Deployment trigger: GitHub Actions runs on push/merge to `dev`. Auto-deploys to Heroku. No direct CLI deploys for production changes.

### Environment Variables

| Var | Purpose |
|---|---|
| `PORT` | Heroku assigns this (auto) |
| `DATABASE_URL` | Neon connection string |
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Secret token for webhook verification |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | OAuth callback URL (Heroku domain + /oauth/google/callback) |
| `GROQ_API_KEY` | Groq API key |
| `ENCRYPTION_KEY` | 256-bit key for AES-GCM token encryption |
| `APP_URL` | Heroku app URL (for OAuth redirect + webhook registration) |
| `NODE_ENV` | `production` |

---

## 6. Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-01 | OAuth tokens NEVER logged or exposed in error messages |
| NFR-02 | Token refresh failure → notify user, do not silently break |
| NFR-03 | Rate-limit users: max N commands per minute |
| NFR-04 | Gmail API quota errors → backoff + retry (exponential) |
| NFR-05 | AI classification failures → graceful fallback to keyword-based |
| NFR-06 | Scheduler skips user on transient failure, retries next cycle |
| NFR-07 | Telegram send failures → retry once without Markdown, then log |

---

## 7. Backend Service Boundaries

| Service | Responsibility |
|---|---|
| Command Handler | Parse Telegram updates, validate/authenticate, dispatch |
| OAuth Service | Google OAuth URL generation, callback, token exchange, refresh |
| Connection Service | CRUD for OAuth connections (tokens encrypted at rest) |
| Gmail Service | Gmail API wrapper — search, list, get, send |
| AI Service | Classify, summarize, answer questions, extract intent |
| Telegram Service | All outbound Telegram messages (send, format, inline keyboards) |
| User Service | User CRUD, preferences, scheduler query |

**All responses to the user flow through `Telegram Service → Telegram Bot API → User`.**

---

## 8. Out of Scope (v2)

- Email attachments upload/send
- Multiple Gmail accounts per user
- OAuth providers beyond Google (Outlook, Yahoo)
- Web dashboard / admin panel
- Email threading / conversation view
- Push notifications (only Telegram)
- Payment / subscription system

---

## 9. Definitions

| Term | Definition |
|---|---|
| Monitoring flow | Server fetches unread emails on a timer, classifies, notifies. No user action required. |
| Command flow | User sends a `/command`, server processes, returns result. Synchronous request-response. |
| classifyEmail | AI or rule-based categorization into urgent/important/normal/ignore |
| summarizeEmails | Condense a list of classified emails into a single digest message |

---

*Derived from TELEGRAM_ANALYSIS.md (v1 analysis) and architecture_v3.excalidraw (v3 system design).*

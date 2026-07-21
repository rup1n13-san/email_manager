# Email Manager v2

A multi-user Telegram bot that connects Gmail accounts via OAuth. Search, read, send emails, and receive AI-powered summaries — all from Telegram. Runs as a persistent NestJS server with a built-in scheduler for passive email monitoring.

**V1 (Python)** is preserved under the `v1-python` tag.

---

## Features

| Feature | Description |
|---|---|
| OAuth Gmail | Connect Gmail via Google OAuth — no app passwords needed |
| Email Search | Full Gmail query syntax via `/search` |
| Email Write | Compose and send via `/write` |
| AI Summary | Classify and summarize unread emails via `/summary` (Urgent / Important / Normal / Ignore) |
| Passive Monitoring | Server-side scheduler checks inbox every N hours per user |
| Multi-User | One bot, many users — each with their own Gmail connection |
| Account Disconnect | Revoke OAuth tokens and delete stored data via `/disconnect` |

---

## Commands

| Command | Action |
|---|---|
| `/start` | Register with the bot |
| `/connect` | Get a Google OAuth URL, grant Gmail access |
| `/search <query>` | Search emails using Gmail query syntax |
| `/write to: email subject: text body: text` | Compose and send an email |
| `/summary` | AI-classified summary of recent unread emails |
| `/disconnect` | Revoke access and remove stored tokens |
| `/help` | List all commands |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22+ (ESM) |
| Framework | NestJS 11 |
| Language | TypeScript 5.7+ (strict mode) |
| ORM | Prisma 7 |
| Database | PostgreSQL (local via Docker, prod via Heroku Postgres) |
| Build | SWC |
| Telegram (in) | Webhook endpoint in NestJS controller |
| Telegram (out) | Raw `fetch()` to Bot API |
| Scheduler | `@nestjs/schedule` |
| Gmail | `googleapis` (REST API, no IMAP) |
| AI | `groq-sdk` (Llama 3.3 70B) |
| Auth | Passport + JWT |
| Deployment | Heroku |

---

## Quick Start

### Prerequisites

- Node.js 22+
- Docker (for local PostgreSQL)
- Telegram Bot Token from [@BotFather](https://t.me/BotFather)
- Google Cloud project with Gmail API enabled and OAuth 2.0 credentials

### Development

```bash
cd backend
cp .env.example .env
# Fill in required env vars (see below)

npm install
docker compose up -d   # start PostgreSQL
npx prisma migrate dev
npm run start:dev
```

### Required Environment Variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Secret for webhook verification |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | OAuth callback URL |
| `GROQ_API_KEY` | Groq API key |
| `ENCRYPTION_KEY` | 256-bit key for AES-GCM token encryption |
| `APP_URL` | Base URL of the running app |

---

## Project Structure

```
backend/
├── src/
│   ├── main.ts
│   ├── common/        # Guards, interceptors, filters, helpers
│   ├── config/        # Env validation
│   ├── core/          # Business modules (telegram, oauth, gmail, ai, user, connection, scheduler)
│   └── prisma/        # PrismaModule + PrismaService
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── docker-compose.yaml
└── test/
```

---

## Architecture

```
Telegram User → Telegram API → Webhook (NestJS Controller)
                                    ↓
                              Command Handler
                           /        |        \
                    OAuthService  GmailService  AIService
                          |            |            |
                    ConnectionService              |
                          |                        |
                      [PostgreSQL]       [Groq API / Gmail API]

Scheduler (@Cron) → Iterate users → Fetch unread → Classify → Send via Telegram
```

---

## License

MIT — see [v1-python](https://github.com/rup1n13-san/email_manager) for the original Python version.

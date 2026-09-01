# AGENTS.md — Email Manager

## Identity

You are a senior full-stack engineer building a multi-user Telegram bot
that manages Gmail accounts via OAuth and AI classification. Your role
is to deliver solid, production-grade NestJS code. Challenge assumptions.
Propose better alternatives. Validate before coding.

---

## Bootstrap (every session)

1. Read `docs/PRD.md` — system requirements and architecture
2. Read `project/status.md` — where are we?
3. Check `project/todo.md` — today's task scope
4. Load only files relevant to today's scope
5. One-time per clone: `git config core.hooksPath .githooks` — enables the pre-commit
   lockfile check (see Lockfile Discipline below)

---

## Lockfile Discipline

`backend/package-lock.json` has drifted out of sync with `package.json` and broken CI
multiple times (see `project/lessons.md`). Rule: never hand-edit or partially regenerate
the lockfile. Always run a full `npm install` in `backend/` after any `package.json`
change, then verify with `npm ci` (the exact command CI runs) before committing.

`.githooks/pre-commit` enforces this automatically once `core.hooksPath` is set (step 5
above): it runs `npm ci --dry-run` whenever `package.json` or `package-lock.json` is
staged and blocks the commit if they're out of sync.

---

## Schema Discipline

`schema.prisma` is a design artifact, not an append target. Patching it one column per feature
cost a full remodel once already (see `project/lessons.md`, 2026-08-13). Before adding or
changing any field:

1. Nullable because it's genuinely optional at read time, or just convenient to write now?
2. Closed set of values → `enum`, never a bare `String`.
3. Every model carries `createdAt` + `updatedAt`.
4. Every id pointing at another row has a real `@relation` with an explicit `onDelete`.

Then read the generated `migration.sql` before it reaches a table with rows. Prisma Migrate
diffs *shapes*, never data: it emits `DROP COLUMN` + `ADD COLUMN` for renames and type changes,
which loses data and hard-fails on non-empty tables. `prisma migrate diff` reporting "no
difference" says nothing about whether the path there destroys rows.

---

## Tech Stack (locked — do not suggest alternatives)

| Layer | Technology |
|---|---|
| Runtime | Node.js 22+ ESM (`"type": "module"`) |
| Framework | NestJS 11 |
| Language | TypeScript 5.7+ (`strict`, `nodenext` resolution) |
| ORM | Prisma 7 |
| Database | PostgreSQL |
| Build | SWC |
| Telegram outbound | `fetch()` to Bot API — no framework |
| Telegram inbound | Webhook in NestJS controller. Signature verified via `X-Telegram-Bot-Api-Secret-Token`. |
| Scheduler | `@nestjs/schedule` (`@Cron()`) |
| Google APIs | `googleapis` npm |
| AI | `groq-sdk` npm |
| Validation | `class-validator` + `class-transformer` |
| Auth | Passport + JWT |
| Lint | ESLint 9 + Prettier |

---

## Architectural Locks (never revisit)

| Decision | Rule |
|---|---|
| **ULID for all PKs** | Never UUID, never auto-increment |
| **Response envelope** | `{ success: boolean, data: T, meta?: object }` — every endpoint. Success wrapper: `{ success: true, data: X }`. Error wrapper: `{ success: false, message: string, code: string }`. Applied via `ApiResponseInterceptor`. |
| **OAuth tokens encrypted at rest** | AES-256-GCM with `ENCRYPTION_KEY` env var. Never plaintext in DB or logs. |
| **ESM `.js` imports** | `import { X } from './x.service.js'` — even for `.ts` files |
| **No IMAP** | Gmail REST API only. IMAP was v1. Never suggest it. |
| **No Telegram framework for outbound** | Raw `fetch()`. `python-telegram-bot` was overkill in v1. Same applies here. |
| **AI fallback preserved** | Groq unavailable → keyword-based classification. The v1 `classify_basic()` logic must exist in v2. Never remove it. |
| **No `Co-authored-by` in commits** | Never. |
| **No `feature`, `add`, `update`, `wip` commit types** | Only `feat`, `fix`, `refactor`, `chore`, `docs` |
| **PrismaClient import path** | Never `import { PrismaClient } from '@prisma/client'` — fails in ESM. Always import from the generated path: `import { PrismaClient } from '../generated/prisma/client.js'` (or relative from current file). Schema generator uses `provider = "prisma-client"` with `output = "../src/generated/prisma"`. |

---

## Project Structure Conventions

```
backend/src/
  common/       — decorators, guards, interceptors, filters, helpers, shared DTOs
  config/       — per-concern config files (env validation, etc.)
  core/         — business domain modules (telegram, oauth, gmail, ai, user, connection, scheduler)
  generated/    — Prisma-generated client (gitignored, regenerated on prisma generate)
  prisma/       — PrismaModule, PrismaService, extensions
```

Each module: `*.module.ts`, `*.controller.ts`, `*.service.ts`, optional `dto/` subfolder.

Unit tests colocated (`*.spec.ts`). E2E tests in `backend/test/e2e/`.

---

## Pre-Code Checklist

Before writing a single line:

1. What is the root cause or goal?
2. Does this break existing patterns in the module?
3. Is there already a helper or service that does this? (`grep -r` first)
4. Read an adjacent service/DTO to match the existing return pattern

Never invent what already exists.

---

## Code Quality Standard

- Can a junior read this function without explanation? No → simplify
- Complexity for a future case that doesn't exist? Yes → cut it
- Shortest version that handles happy path + failure? No → rewrite

The bar: would a senior engineer approve this in code review without a single comment?

---

## Git & Commits

- **Never commit without explicit approval**
- One branch = one logical change
- Branch naming: `backend/feat/scope/short-desc` off `dev`, PR into `dev`. The `backend/` prefix signals the subproject being modified (v2 lives in `backend/`, v1 at root).

### Commit format

```
type(scope): subject (imperative, lowercase, ≤60 chars)

- what changed and why (bullet)
- one bullet = one logical change
- max 3 bullets
```

### MR format

```
### Purpose
[what this branch delivers, 2-3 sentences]

### New Endpoints
| Method | Route | Description |
[omit if none]

### Main Changes
- [what changed and why]

### Notes
- Env vars required (if any)
- Out of scope
```

---

## Pre-Merge Review

Before any commit on a completed feature, read every created/modified file as
a reviewer seeing it for the first time. Check:

1. **Design** — single responsibility? follows existing patterns?
2. **Contract** — does the implementation match what the caller/API sends?
3. **Integration** — will other modules consume this cleanly?
4. **KISS** — any function doing in 20 lines what 8 would do?
5. **Conventions** — ESM `.js` imports? Response envelope? No circular deps?

Output: `file:line | issue | BLOCKER / SHOULD FIX / MINOR`

Verdict: ready to merge? Yes / No / With conditions.
**No fixes until user validates.**

---

## Post-Task

After every task:

1. Anything fail or need multiple attempts?
   → Append to `project/lessons.md`:
   `[YYYY-MM-DD] | what went wrong | rule to avoid it`

2. Is `project/status.md` outdated?
   → Update it

3. Significant architectural decision made?
   → Write it in `project/decisions/<topic>.md`

Skipping this = lost knowledge.

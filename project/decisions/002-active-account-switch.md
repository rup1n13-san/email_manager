# 002 — Active-account model for multi-Gmail, mirrors `gh auth switch`

**Status:** Accepted, 2026-08-12. Supersedes part of [001](001-ai-tool-calling-agent.md) (the per-tool `email` arg).

## Context

001 gave every AI tool an optional `email` arg plus an ambiguous-result fallback,
resolved on every call. Reconsidered: the model shouldn't have to reason about which
inbox on every request.

## Decision

One Gmail account is "active" per user at a time, for interactive use only. A new
deterministic `/switch` command changes it (same tier as `/connect`/`/disconnect`).
`TelegramService` resolves the active account once, before Groq is ever called, and
hands its tokens to the tool dispatcher — tools no longer take an `email` arg at all.

**Scheduler never uses this.** Passive monitoring covers every connected account on
every run, regardless of which is active — active-account is a chat-session
convenience layered on top of full-coverage monitoring, never a scope restriction
on it.

## Why

- `activeConnectionId` on `User` (nullable FK), not an `isActive` flag on
  `Connection` — Prisma 7 can't declaratively enforce "at most one active row"
  without raw SQL; a nullable scalar makes that invariant free.
- Connecting an account auto-activates it (mirrors `gh auth login`) — no
  special-casing a user's first `/connect`.
- Bare `/switch` with >1 account always lists and asks for an email, even at exactly
  2 — consistent with how `/disconnect` already behaves, rather than a one-off toggle
  shortcut.
- Fewer args per tool call also means more reliable function-calling — one less thing
  the model can get wrong.

## Consequences

- New migration + `ConnectionService.getActive/setActive`, replacing `getTokens()`
  (which silently grabbed the first Google connection — a real bug this fixes).
- `disconnect()` needs fix-up logic so the active pointer never dangles.

Full task breakdown: `project/todo.md`, Phase 4c.

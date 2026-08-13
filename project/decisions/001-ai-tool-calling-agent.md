# 001 — AI tool-calling agent replaces deterministic email commands

**Status:** Accepted, 2026-08-12. Partially superseded by [002](002-active-account-switch.md) (account resolution).

## Context

Phase 4 planned `/search`, `/write`, `/summary` as separate deterministic handlers.
Audit found `TelegramService` was also silently dropping all plain-text messages —
no free-text path existed at all.

## Decision

`GmailService` methods become tools; one Groq-backed agent decides which to call from
free text. Account-management commands (`/start /help /connect /list /disconnect
/switch`) stay deterministic — no ambiguity to resolve there. Everything else routes
to the agent.

Tools: `search_emails`, `list_unread_emails`, `read_email`, `create_draft_email`
(draft only, no send — see Why). Summarizing/classifying are **not** tools — that's
the model's own synthesis over tool output, not a separate call.

Agent loop: system + user message → Groq (`tool_choice: auto`) → execute `tool_calls`
→ loop → stop on no more tool calls or after 4 rounds (hard cap). Fallback chain:
Groq → Gemini (OpenAI-compatible endpoint) → "temporarily unavailable" message — each
step a hard stop, never unbounded retry.

Scheduler bypasses the agent entirely — passive monitoring already knows what to do
(classify + summarize unread), there's no tool to pick.

## Why

- **Groq primary, not Gemini:** verified 128K context / 280 tok/s on
  `llama-3.3-70b-versatile`, and speed matters for chat UX. Free tier is tight (30
  RPM / 12K TPM / 1K RPD) — rate-limit hits are expected, not exceptional.
- **Gemini fallback, not "the better model":** its ~1M context is a different failure
  mode (rescues a request that blew Groq's TPM cap), not a quality upgrade — tool
  payloads are already kept small on purpose.
- **Draft, not send:** sending is irreversible; a Gmail draft gives the same value
  without a confirm-before-send state machine. Supersedes PRD FR-GM-06 / §2.3
  (compose-and-send) — deliberate deviation, not an oversight.

## Consequences

- `GmailService` needs real implementations, not stubs.
- Every free-text message costs an LLM call — still $0/mo, but throughput, not spend,
  is the real constraint.
- No keyword-based fallback for v1; if both providers fail, the user is told to retry.

Full task breakdown: `project/todo.md`, Phase 4b.

# Lessons — Email Manager v2

_Errors encountered and rules to prevent recurrence._

---

### [2026-09-01] | `tsconfig` `baseUrl` makes bare imports typecheck but fail at runtime

`import { encodeOAuthState } from 'src/common/helpers/oauth-state.js'` passed `tsc --noEmit`
cleanly because `tsconfig.json` sets `"baseUrl": "./"`. It then failed at runtime with
`Cannot find module` — under Jest, `nest build` output, and production alike. `baseUrl` is a
TypeScript type-resolution concept only; Node's ESM loader knows nothing about it and treats
`src/...` as a bare package specifier. `tsc` passing is not evidence that an import resolves.

**Rule:** In this repo always use relative imports (`../../common/helpers/x.js`). Never trust
`tsc --noEmit` alone to validate a new import path — run the test suite or boot the app, which
exercise real module resolution.

### [2026-09-01] | Revoking before deleting lets a concurrent confirm win a dead grant

`rejectConnection()` and `sweepStalePending()` originally called `revokeGoogleToken()` and
*then* ran a status-guarded `deleteMany`. The delete is atomic; the revoke was not gated on it.
If a user tapped Confirm at the same moment, confirm's `updateMany` flipped the row to
`CONFIRMED` and the delete correctly no-opped — but the token had already been revoked at
Google. Result: a `CONFIRMED` connection whose grant is dead, `/list` showing an account where
every API call 401s, and nothing in the system knowing why.

**Rule:** When an external side effect (revoke, refund, email) accompanies a DB state change,
do the guarded DB write **first** and perform the side effect only if it reported `count === 1`.
Whoever wins the atomic write owns the side effect.

### [2026-09-01] | `git stash pop` grabs the newest stash, not "yours"

Running `git stash -u` in a clean tree creates nothing, so a later `git stash pop` consumed a
**pre-existing stash from a different branch and an earlier session**, dropping its untracked
`CLAUDE.md` into the tree and conflicting on `project/status.md`/`todo.md`. Nothing was lost
only because the conflicted pop keeps the entry — a clean pop would have silently consumed it.

**Rule:** Run `git stash list` before any stash operation in this repo. Prefer
`git stash push -m "<label>"` and pop by explicit ref (`git stash pop stash@{0}` after
confirming the label), or avoid stashing entirely by committing WIP to a scratch branch.

### [2026-09-01] | GitHub can reject a push over an email already public in the repo's history

`GH007: Your push would publish a private email address` blocked a push whose commits used
`rupinie.adjohou@epitech.eu` — the same address as all 59+ existing commits on `dev`/`main`.
The account setting "Block command line pushes that expose my email" had been enabled after
those commits were already public, so the protection blocked new work without hiding anything.

**Rule:** If `GH007` appears on a repo whose history already carries that address, disabling
the toggle at github.com/settings/emails is the correct fix — rewriting author emails on a few
commits makes them inconsistent with the rest of the history for no privacy gain.

### [2026-07-22] | ESM + Prisma Client: `@prisma/client` named imports fail at runtime

`import { PrismaClient } from '@prisma/client'` crashes with `does not provide an export named 'PrismaClient'` in ESM projects (`"type": "module"`). `@prisma/client` ships CJS. Its entry is `module.exports = { ...require() }` — Node's static CJS→ESM bridge cannot detect named exports from this dynamic spread pattern. The `PrismaClient` becomes invisible.

**Rule:** Never `import { PrismaClient } from '@prisma/client'`. Always use `generator client { provider = "prisma-client" output = "../src/generated/prisma" }` in `schema.prisma`. Import from the generated path: `import { PrismaClient } from '../generated/prisma/client.js'`. This generates TypeScript source that SWC compiles to native ESM.

### [2026-07-22] | Lockfile corruption with `@emnapi/*` transitive deps

`npm ci` fails after `npm install` when `@swc/core`'s optional `@emnapi/*` transitive dependencies leave the lockfile in an inconsistent state. Each `npm install` does partial re-resolution, and npm's lockfile v3 can write entries it later rejects with `npm ci`.

**Rule:** When `npm ci` fails with `Invalid: lock file's @emnapi/X does not satisfy @emnapi/Y`, pin the problematic transitive deps explicitly as devDependencies, then delete `node_modules` and `package-lock.json`, run `npm install` to regenerate from scratch, and verify `npm ci` passes locally.

### [2026-07-22] | Generated Prisma client missing on Heroku deploy

`src/generated/prisma/` is gitignored, so it doesn't reach Heroku. Build fails with `Cannot find module '/app/dist/generated/prisma/client.js'`. Heroku's build only runs `npm ci` → `nest build` — no `prisma generate`.

**Rule:** Add `"postinstall": "npx prisma generate"` to `package.json` scripts. This hooks into Heroku's build pipeline and generates the client after `npm ci`, before `nest build`.

### [2026-07-24] | Heroku Postgres SSL with `@prisma/adapter-pg` fails with `no encryption` then `unable to get local issuer certificate`

`sslmode=require` causes `TlsConnectionError: unable to get local issuer certificate` because Heroku Postgres uses certificates not in Node's CA bundle. `sslmode=no-verify` enables TLS without CA validation.

**Rule:** For Heroku Postgres + `@prisma/adapter-pg`, use `?sslmode=no-verify` (not `require`) when appending SSL to `DATABASE_URL`.

### [2026-07-24] | Amending a merged PR's branch does not update `dev`

Force-pushing to a branch after its PR was merged has no effect — the merge commit on `dev` already has the old content. The fix must go through a new PR.

**Rule:** Never amend/force-push a branch after its PR is merged. Create a new branch + PR.

### [2026-07-24] | `validateEnv()` startup validation catches missing env vars early

Previously required env vars like `TELEGRAM_BOT_TOKEN` were only checked at first use (e.g. when a user sent a message). Now `ConfigModule.forRoot({ validate: validateEnv })` fails at app bootstrap.

**Rule:** Use `ConfigModule.forRoot({ validate })` to catch missing required env vars at startup, not at first call.

### [2026-08-03] | Peer deps of an optional dep silently dropped from lockfile, broke `npm ci` twice in a row

Adding `dd-trace` for Datadog APM pulled in `@datadog/openfeature-node-server` as an
*optional* dependency, which declares `@openfeature/server-sdk` as a *peer* dependency.
npm auto-installs peer deps on a real `npm install`, but the prior "regenerate
package-lock.json" fix commit didn't do a full resolve, so `@openfeature/server-sdk` +
`@openfeature/core` stayed missing from the lockfile — `npm ci` failed in CI on two
consecutive pushes with `Missing: X from lock file`. This is the 4th separate
lockfile-drift incident in this file.

**Rule:** Never hand-edit or partially regenerate `package-lock.json`. After any
`package.json` change, run a full `npm install`, then verify with `npm ci` (the exact
command CI runs) before committing. Now enforced by `.githooks/pre-commit` — enable
once per clone with `git config core.hooksPath .githooks`.

### [2026-08-06] | `prisma migrate deploy` P1001 against Heroku RDS-backed Postgres — built a workaround before checking for an upstream fix

Prisma's classic schema-engine (used only by `migrate deploy`/`migrate dev` — separate
from the app's runtime `@prisma/adapter-pg` client) failed every connection attempt to
Heroku's `essential-0` Postgres (backed by a real AWS RDS Aurora cluster endpoint) with
`P1001: Can't reach database server`, regardless of `sslmode` (`no-verify` and `require`
both failed identically). This blocked the Heroku release phase on every deploy, silently
keeping production on stale code for 30+ hours. Layered testing from inside real Heroku
dynos — raw TCP, then a full TLS+Postgres handshake via `node-postgres` — both succeeded
instantly, isolating the bug to Prisma's own engine, not the network, DB, or SSL config.
A full pass was spent building a custom migration-runner script (`pg` + hand-rolled
`_prisma_migrations` tracking) before testing the obvious cheap thing:
`npx prisma@latest migrate status` against production. It worked immediately — the bug
was already fixed in 7.9.1 (project was pinned to 7.7.0, installed 7.9.0).

**Rule:** When a well-known library's CLI/engine fails in a way the library's own driver
doesn't, check for a newer version before building a workaround. `npx <pkg>@latest
<command>` against the real target (in a disposable context — one-off dyno, throwaway
branch) is a near-zero-cost test that rules out an already-fixed upstream bug before any
code gets written. Only build custom tooling after confirming there's no config flag and
no newer version that fixes it — search the library's docs/source (e.g. via Context7)
for the actual supported mechanism first, rather than assuming the API surface you'd
expect exists.

### [2026-08-06] | Datadog Heroku buildpack silently defaults to the US1 site — traces dropped with 403, no startup error

`DD_SITE` was never set. The Datadog Heroku buildpack defaults to `datadoghq.com` (US1)
when it's unset, with no warning at boot — the agent starts fine, `dd-trace` loads fine,
everything looks healthy. The only symptom was buried in the logs: `Retried payload 4
times: server responded with "403 Forbidden"` / `Dropping Payload after 4 retries`. This
org's Datadog account is on US5, so the (valid) API key was being sent to the wrong
region's intake and rejected.

**Rule:** When adding Datadog APM to a Heroku app, always set `DD_SITE` explicitly to
match the account's actual site (check the Datadog app URL — `us5.datadoghq.com`,
`datadoghq.eu`, etc.) rather than relying on the US1 default. A missing/wrong `DD_SITE`
fails silently — nothing errors until you notice traces never show up in the UI.

### [2026-08-13] | Prisma schema patched incrementally across 4 migrations — cost a full remodel and a destructive migration

`Connection` and `EmailPreference` were never designed, only patched. Each feature added one
column and moved on: `email` arrived nullable in `multi_account_connections` even though
`/switch` and `/disconnect` address accounts *by email*; `provider` stayed a bare `String`
while the code compared it to the literal `'google'` in four places; `EmailPreference` shipped
with no `createdAt`/`updatedAt`; and `activeConnectionId` was first added as a scalar with no
foreign key, so nothing stopped it pointing at a deleted or another user's connection. Fixing
all of it at once meant a remodel touching 7 files, and a migration that had to `DELETE FROM
"Connection"` because Prisma cannot rename or cast — it emits `DROP COLUMN` + `ADD COLUMN
NOT NULL`, which both loses data and hard-fails on any table that has rows.

**Rule:** Treat `schema.prisma` as a design artifact, not an append target. Before adding or
changing a field, ask the four questions that were skipped here: is it nullable only because
it's convenient right now, or genuinely optional at read time? is it a closed set that should
be an enum instead of a `String`? does every model carry `createdAt`/`updatedAt`? does every
id pointing at another row have a real `@relation` with an explicit `onDelete`? Then always
read the generated `migration.sql` before it reaches a table with rows — Prisma Migrate diffs
*shapes*, never data, so `prisma migrate diff` reporting "no difference" says nothing about
whether the path there destroys rows.

### [2026-08-27] | `main` sat 59 commits behind `dev` with a fake `EncryptionHelper`, and it became live risk the moment this repo was cited externally

The 2026-07-24 lesson already established "never amend a merged branch, always PR" — but no
rule ever said `main` had to stay in sync with `dev` on any particular cadence, so it silently
drifted for a month while all real work landed on `dev`. That was harmless as long as nobody
outside this repo looked at it. It stopped being harmless the day `main`'s URL got typed into
an MLH Fellowship application as the code sample — GitHub shows `main` by default with no
branch in the URL, and `main` still had the original `EncryptionHelper.encrypt() { return
plaintext }` stub under a README already claiming finished OAuth/AI/encryption features.

**Rule:** A public repo's `main` branch is a claim about the project, made continuously, to
anyone who opens the URL — not just the branch that happens to hold the merged history. Once
a repo is (or might be) referenced externally — a resume, an application, a portfolio link —
treat `dev` lagging behind `main` by more than a feature or two as a bug, not backlog, and
merge on a short cadence rather than batching 59 commits.

### Format
```
[YYYY-MM-DD] | what went wrong | rule to avoid it next time
```

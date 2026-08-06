# Lessons — Email Manager v2

_Errors encountered and rules to prevent recurrence._

---

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

### Format
```
[YYYY-MM-DD] | what went wrong | rule to avoid it next time
```

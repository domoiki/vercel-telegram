# Telegram AI Gateway

> Indonesian version: [README.ind.md](./README.ind.md). The dashboard UI itself is in English.

A single-user operations console for a personal Telegram ⇄ AI gateway.

A Vercel serverless function receives Telegram webhook updates, checks the chat
against a three-slot allowlist, routes the message through an ordered chain of AI
providers with automatic retry and fallback, sends the reply back to Telegram, and
records every step of what happened so you can read it afterwards.

Everything is configured from the dashboard. Adding a provider, changing a chat id
or reordering the fallback chain never requires a redeploy or an environment edit.

---

## Contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Quick start](#quick-start)
- [Turso setup](#turso-setup)
- [Deploying to Vercel](#deploying-to-vercel)
- [Connecting Telegram](#connecting-telegram)
- [Configuring providers](#configuring-providers)
- [How routing, retry and fallback work](#how-routing-retry-and-fallback-work)
- [The request trace](#the-request-trace)
- [Data model](#data-model)
- [Security model](#security-model)
- [Scripts](#scripts)
- [Testing](#testing)
- [Design system](#design-system)
- [Troubleshooting](#troubleshooting)

---

## What it does

| | |
|---|---|
| **Receives** | Telegram `message`, `edited_message` and `channel_post` updates at `POST /api/telegram/webhook` |
| **Authorises** | Exactly three chat-id slots. Everything else is rejected and optionally answered with a note |
| **Routes** | An ordered chain of providers, each addressed by id — never by array position |
| **Degrades well** | Retries transient failures in place, falls back on hard failures, refuses to burn the chain on a rejected request |
| **Answers** | Splits long replies on paragraph boundaries, so Telegram never truncates |
| **Records** | Every message, every provider attempt, every request event, every log line |
| **Explains** | A per-request timeline you can read like a console log |

---

## Architecture

```
Telegram  ──POST──▶  /api/telegram/webhook            (Vercel serverless, Node)
                          │
                          ├─ 1. validate the update shape
                          ├─ 2. claim update_id          ← idempotency gate
                          ├─ 3. check the chat allowlist
                          ├─ 4. load the conversation and its history
                          ├─ 5. route through the provider chain
                          │       ├─ provider A ──retry──▶ provider A
                          │       └─ fallback ──────▶ provider B ──▶ provider C
                          ├─ 6. send the reply to Telegram
                          └─ 7. persist everything
                          ▼
                      Turso (libSQL)
```

**No long polling.** Telegram pushes to the webhook; the function answers and exits.

**No in-memory source of truth.** The only in-process state is a cached database
connection per warm instance. Everything else lives in Turso, so the dashboard and
the webhook always agree and a cold start loses nothing.

**Migrations run once, not per request.** The schema is applied by `npm run db:migrate`
at deploy time. The request path never migrates.

### Project layout

```
src/
  app/
    (dashboard)/         Overview, Messages, Conversations, Requests, Providers, Logs, Settings
    api/                 webhook receiver, provider/settings/telegram routes
  components/
    ui/                  Button, Badge, Panel, Field, Dialog, Toast, Table, Stat
    layout/              Sidebar, Topbar, AppShell
    charts/              dependency-free bar chart and latency bars
    timeline/            the request trace — the centrepiece
    providers/           provider form and manager
    settings/            conversation, telegram and appearance sections
  lib/
    db/                  Drizzle schema, migrations, seed, demo seed
    providers/           adapter registry, HTTP, router (retry + fallback)
    telegram/            update validation and Bot API client
    gateway.ts           the webhook pipeline
    crypto.ts            AES-256-GCM at rest
    sanitize.ts          credential scrubbing
  *.test.ts              unit tests
scripts/
  smoke.ts               end-to-end reliability run
  audit.mjs              responsive/contrast/accessibility sweep
  shoot.mjs              screenshot capture
```

---

## Quick start

Requires **Node 20+**.

```bash
git clone <your-repo> telegram-ai-gateway
cd telegram-ai-gateway
npm install

cp .env.example .env.local
# fill in DATABASE_URL and ENCRYPTION_KEY (see below)

npm run db:migrate      # create the schema
npm run db:seed         # optional: write the default settings rows
npm run dev             # http://localhost:3000
```

For local work without Turso, point at a SQLite file — the app uses the same
driver, so nothing else changes:

```dotenv
# .env.local
DATABASE_URL=file:./data/gateway.db
ENCRYPTION_KEY=<64 hex characters>
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Generate an encryption key with either:

```bash
openssl rand -hex 32
# or
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> `ENCRYPTION_KEY` is not a database secret — it is the key that encrypts the bot
> token and every provider key at rest. **Changing it makes existing encrypted
> values unreadable.** Store it in a password manager before you use a real bot.

Want to see the dashboard with realistic traffic in it? `npm run db:seed:demo`
fills a local database with sample providers, conversations, messages, requests
with fallback histories, and logs. It refuses to run against a remote database.

---

## Turso setup

The app speaks libSQL, so Turso is the production target and a local SQLite file
is the development one.

```bash
npm install -g @turso/cli
turso login
turso db create gateway          # note the URL and token
turso db tokens create           # read/write token
```

Then set these in `.env.local` locally and in the Vercel project for production:

```dotenv
TURSO_DATABASE_URL=libsql://gateway-your-name.turso.io
TURSO_AUTH_TOKEN=<read-write token>
ENCRYPTION_KEY=<64 hex characters>
```

Apply the schema once:

```bash
npm run db:migrate
```

`db:migrate` is idempotent — it tracks applied migrations in `__drizzle_migrations`,
so re-running it is safe and does nothing on the second run.

Inspect the data any time with `npm run db:studio` (Drizzle Studio).

---

## Deploying to Vercel

1. **Push the repository** to GitHub, GitLab or Bitbucket.

2. **Import it** into Vercel. The defaults are correct; no build settings needed.

3. **Add the environment variables** under *Settings → Environment Variables*,
   marking each one **Production**, **Preview** and (optionally) **Development**:

   | Variable | Required | Notes |
   |---|---|---|
   | `TURSO_DATABASE_URL` | yes | `libsql://…` |
   | `TURSO_AUTH_TOKEN` | yes | read-write token |
   | `ENCRYPTION_KEY` | yes | 64 hex characters; changing it invalidates stored secrets |
   | `NEXT_PUBLIC_APP_URL` | recommended | e.g. `https://gateway.example.com`. Only used to register the webhook; falls back to `VERCEL_PROJECT_PRODUCTION_URL`, then `VERCEL_URL` |
   | `ADMIN_API_KEY` | optional | When set, write routes require a matching `x-admin-key` header |

4. **Deploy.** The first build runs `next build`; migrations are *not* run
   automatically, so run them once from your machine against the production
   database (see below).

5. **Apply the schema to production**, once:

   ```bash
   # from your machine, with the production values in .env.local
   npm run db:migrate
   ```

   Or paste the contents of `drizzle/0000_init.sql` into the Turso shell
   (`turso db shell <database>`). The file is plain SQL.

6. Open the deployment and go to **Settings → Telegram**.

> **Deploying again is safe.** Migrations are versioned, and the app never migrates
> on a request. You can redeploy whenever you like.

### About the admin key

There is no login, no user table and no session system — this is a personal tool
for a single operator, and the brief for it explicitly rules out a full auth
system. What it has instead is a narrow guard on *write* routes:

- When `ADMIN_API_KEY` is unset, the dashboard is open. Fine on localhost, and
  fine behind a Vercel deployment protection rule on a private account.
- When it is set, every mutating API route requires a matching `x-admin-key`
  header. The dashboard asks once and keeps the value in **`sessionStorage`
  only** — deliberately not `localStorage`, so it does not outlive the tab.

Read routes, including the whole dashboard, stay open. If you need the deployment
itself private, turn on Vercel's deployment protection.

---

## Connecting Telegram

1. **Create a bot.** Message [@BotFather](https://t.me/BotFather) → `/newbot`.
   Copy the token. It looks like `123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw`.

2. **Paste it into Settings → Telegram → Bot token** and save. The token is
   encrypted with AES-256-GCM before it touches the database and is never
   returned to the browser — the field shows a mask like `1234••••••pass`.
   Use **Test bot connection** to verify it.

3. **Find your chat id.** Send any message to the bot, then open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` and read
   `result[].message.chat.id`.

   | Chat | Where the id looks like |
   |---|---|
   | Private chat | `555000111` |
   | Group | `-1001234567890` |
   | Channel | `-1001234567890` |

   Only the three **chat id** slots exist, not the user's id — in a group the id
   belongs to the group, so everyone in an allowed group is allowed.

4. **Fill the three slots** and save. Leave a slot empty to skip it.

5. **Register the webhook.** Click **Register webhook** in the same panel. The
   dashboard calls Telegram's `setWebhook` with your deployment's public URL plus
   `/api/telegram/webhook`.

   You do not have to trust the URL: click **Check status** and the app reads
   `getWebhookInfo` straight from Telegram, so what you see is Telegram's own
   view, not a cached value.

6. **Send your bot a message.** The reply arrives in Telegram; the matching
   request trace appears on the dashboard under **Messages**.

### Commands

| Command | Behaviour |
|---|---|
| `/start`, `/help` | Answered locally. Costs no provider call. |
| `/reset` | Clears the conversation history for that chat, then confirms. |

### Why the reply sometimes says the gateway failed

That message is the gateway being explicit rather than silently ignoring someone.
It appears when every provider in the chain failed. The **request trace** named in
the message is the fastest way to see which ones and why.

---

## Configuring providers

Providers are added entirely from **AI Providers**. There is a fixed number of
zero environment variables involved and no redeploy.

Click **Add provider**:

| Field | Meaning |
|---|---|
| **Name** | Shown throughout the dashboard. Anything you like. |
| **Base URL** | The API root. Include the version segment: `https://openrouter.ai/api/v1` |
| **API key** | Stored encrypted. Only a mask is ever shown again. |
| **Model** | The model id to request. |
| **Adapter** | Which request/response shape to speak. See below. |
| **Custom headers** | Optional `Name: value` pairs, encrypted with the key. |
| **Timeout** | Overridden by the global provider timeout in Settings. |
| **Cost** | Optional $/1M input and output tokens, for the cost column. |

**Test connection** performs a real round trip and reports the HTTP status, the
latency and the exact error, and stores the result so the provider list shows its
health at a glance.

### Adapters

| Adapter | Use it for | Base URL example |
|---|---|---|
| `openai-compatible` | Anything with a `/chat/completions` endpoint — OpenAI, OpenRouter, Groq, Together, DeepSeek, Ollama, LM Studio, vLLM, most proxies | `https://api.openai.com/v1` |
| `anthropic` | The Anthropic Messages API | `https://api.anthropic.com/v1` |
| `gemini` | Google Gemini | `https://generativelanguage.googleapis.com/v1beta` |
| `custom-http` | Anything else. You supply the body template and a JSON path to the reply text | *your endpoint* |

`custom-http` is a JSONPath-lite: point **Response path** at the string you want,
e.g. `result.answer` or `choices.0.text`. **Body template** is a JSON template
where `{{messages}}`, `{{model}}`, `{{temperature}}` and `{{maxTokens}}` are
substituted.

### Ordering the chain

Drag-free and explicit: use the ↑ / ↓ buttons on each provider. The order is a
stored priority, and the router walks it by **provider id**, so reordering can
never make a request go to the wrong provider. Exactly one provider is the
primary; the rest are fallbacks in priority order. Disabling a provider removes
it from the chain without deleting it.

---

## How routing, retry and fallback work

The chain is: **try the primary → retry it if the failure was transient → move to
the next provider → repeat.**

### What counts as a failure, and what it triggers

| Condition | Category | Retried in place? | Falls back? |
|---|---|---|---|
| Timeout / abort | `timeout` | yes | yes |
| Network error, DNS failure, socket hang-up | `network` | yes | yes |
| `429` | `rate_limit` | yes | yes |
| `5xx` | `server_error` | yes | yes |
| `401`, `403` | `auth` | no | yes |
| `404` | `config` | **no** | **no** |
| `400`, `422`, other `4xx` | `bad_request` | **no** | **no** |
| Unrecognised error | `unknown` | no | yes |

The distinction that matters: a `400` is the provider telling you the *request*
was wrong. Trying a different provider with the same request will fail the same
way, so the chain stops immediately and the budget is preserved. A `401` is
different — a different provider has a different key, so it is worth trying.

**Retries in place** are capped by *Retries per provider* in
Settings → Conversation (default `2`, so up to three tries each).
**Fallbacks** are unlimited — they are bounded by the number of enabled providers.

### What gets recorded for every attempt

Provider name and id, model, attempt number, start time, duration, HTTP status,
outcome, error category, and the sanitised error message. Each one is a row in
`request_attempts`, visible in the request trace.

### Idempotency

Telegram retries a webhook whenever it does not get a fast `2xx`, and it can
sometimes deliver the same update twice. The `telegram_updates` table has
`update_id` as its **primary key**: the gateway inserts the id and, if that
insert claims nothing, stops the entire pipeline. A duplicate costs one cheap
`INSERT` and produces no second reply, no second provider call and no duplicate
rows.

The webhook answers `200` for a duplicate, a malformed body, a rejected chat and
a handled request — because retrying any of those changes nothing. It answers
`500` only for an unexpected failure, and that is safe precisely because the
update-id ledger makes the replay a no-op if the first attempt got far enough to
claim it.

---

## The request trace

Every request gets a short correlation id (`Request #8F3A21`) and a timeline:

```
23:41:02.004   Webhook received                update_id 800123
23:41:02.011   Telegram update validated       chat 555000111 · @dana · message 9921
23:41:02.012   Chat authorized                Chat id matched an allowlist slot
23:41:02.014   Conversation loaded             18 messages of history (limit 20)
23:41:02.015   Provider selected               OpenRouter · anthropic/claude-3.5-sonnet
23:41:03.402   AI response received            HTTP 200 · 1387ms · 731 tokens
23:41:03.404   Telegram sendMessage started
23:41:03.611   Telegram delivery successful    message_id 778120
23:41:03.612   Request completed               OpenRouter · 1608ms total
```

A fallback looks like this, and the ordering is the useful part:

```
23:44:10.002   Provider selected               OpenRouter · anthropic/claude-3.5-sonnet
23:44:10.884   Provider returned 429           Rate limit reached
23:44:10.885   Retrying provider               OpenRouter · attempt 2 of 3
23:44:11.701   Provider returned 429           Rate limit reached
23:44:11.702   Retrying provider               OpenRouter · attempt 3 of 3
23:44:12.640   Provider returned 429           Rate limit reached
23:44:12.641   Fallback triggered              OpenRouter failed with HTTP 429. Trying Groq.
23:44:13.502   AI response received            HTTP 200 · 861ms · 512 tokens
23:44:13.503   Telegram delivery successful    message_id 778199
23:44:13.504   Request completed               Groq · 3502ms total · 1 fallback(s)
```

Entries are colour-coded by level, the gutter is monospaced, and each node shows
its own delta, so the shape of a slow request is readable at a glance.

---

## Data model

| Table | Holds |
|---|---|
| `settings` | Key/value tunables: history depth, temperature, max tokens, retry budget, provider timeout, default theme |
| `telegram_config` | Singleton row: encrypted bot token, the three chat-id slots, webhook status, bot identity |
| `ai_providers` | Providers, their encrypted keys and custom headers, ordering, enabled/primary flags, last test result |
| `conversations` | One row per chat: display name, message count, last activity |
| `messages` | Both directions, with status, provider, model, latency, request id |
| `ai_requests` | One row per AI turn: correlation id, status, winning provider, token counts, cost, latency, error |
| `request_attempts` | One row per provider call within a request |
| `request_events` | The trace timeline, one row per step |
| `telegram_updates` | The idempotency ledger. `update_id` is the primary key |
| `logs` | Structured application logs across categories |

---

## Security model

**Credentials never reach the browser.** The bot token and every provider API key
are encrypted with AES-256-GCM (`iv.tag.ciphertext`, base64) before they are
stored. Reads from the API return `hasApiKey: true` and a mask like
`sk-a••••••mnop`. There is no code path that returns a decrypted secret over HTTP.

**Secrets are not in the browser at all.** Nothing sensitive is written to
`localStorage` or `sessionStorage`, printed to the console, or included in an
error message. The one exception is the optional `ADMIN_API_KEY`, which the
dashboard holds in `sessionStorage` only — never `localStorage`.

**Errors are scrubbed before they are stored or displayed.** Bearer tokens,
`api_key: …` pairs, Telegram bot tokens, `sk-…`, `AIza…` and JWT-shaped strings
are replaced, in message text, headers and JSON metadata alike. Credential
headers are removed entirely rather than masked.

**Guard rails in the codebase.** Modules holding secrets or touching the database
import `server-only`, so an accidental import from a client component fails the
build rather than leaking at runtime. Shared provider types live in a separate
module specifically to keep that boundary intact.

**Exactly one bot, exactly three chats.** `isChatAllowed` compares chat ids
exactly, and fails closed when no slot is configured. It is never a substring or
prefix match.

**The webhook is the only public write path**, and it accepts only Telegram's
update shape.

---

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (`eslint .`, flat config with `next/core-web-vitals`) |
| `npm run test` | Unit tests (Vitest) |
| `npm run test:watch` | Same, in watch mode |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Write the default settings and the config row |
| `npm run db:seed:demo` | Fill a **local** database with sample traffic |
| `npm run db:studio` | Drizzle Studio |
| `npm run qa:smoke` | End-to-end reliability run (see below) |
| `npm run qa:audit` | Responsive/contrast/accessibility sweep against a running dev server |
| `npm run qa:shots` | Capture screenshots into `.shots/` |
| `npm run gen:key` | Generate a fresh `ENCRYPTION_KEY` |

### `npm run qa:smoke`

Boots a throwaway SQLite database and a local HTTP stand-in for the AI provider,
then drives the **real** gateway through eleven scenarios: the happy path, a
duplicated update, an unauthorised chat, fallback after a `503`, an in-place
retry that recovers from a `429`, a `400` that correctly stops the chain, a
provider timeout, invalid credentials, a Telegram delivery failure, a malformed
update, and a sweep for credential leakage. Only `api.telegram.org` is stubbed,
so the adapter, timeout, router, trace and persistence layers are all genuinely
exercised.

```
✓ all checks passed — 72 passed, 0 failed
```

It needs no network access and touches none of your data.

---

## Testing

```bash
npm run test
```

115 unit tests across seven files, concentrated on the logic that must not
regress silently:

| File | Covers |
|---|---|
| `lib/telegram/validate.test.ts` | Update shape validation, chat allowlist, secret-token comparison |
| `lib/gateway.test.ts` | The whole pipeline: idempotency, authorisation, persistence, provider failure, delivery failure, trace order |
| `lib/providers/router.test.ts` | Retry vs. fallback decisions, chain walking, stop conditions, attempt recording, HTTP status classification |
| `lib/crypto.test.ts` | Encryption round trip, tamper detection, masking |
| `lib/sanitize.test.ts` | Credential scrubbing in text, headers, metadata and errors |
| `lib/telegram/client.test.ts` | Message splitting against Telegram's 4096-character limit |
| `lib/settings.test.ts` | Setting round trip, clamping and fallbacks |

### Dependency advisories

`npm audit` reports only moderate findings, all in dev-only tooling
(`drizzle-kit`'s bundled esbuild, and `@vitest/mocker` in Vitest 3, whose fix
lands in Vitest 4). Neither is reachable in a deployed build: they affect a
local dev server and a test runner. Runtime dependencies are clean — including
`drizzle-orm` ≥ 0.45.2, which closed a SQL-identifier escaping advisory, and
`sharp`/`postcss` pinned via `overrides` past the Next 15.5 dependency ranges.

---

## Design system

**"Signal Console."** The subject is a switchboard: a signal arrives, crosses a
chain of processors, lands or breaks. The interface is a warm graphite console
with a single brass indicator colour, because a live indicator should read as a
lit lamp rather than a glow.

- **Dark and light are both designed**, not one inverted into the other. The
  default follows your system; the choice is saved and applied server-side.
- **Archivo** for the interface, **JetBrains Mono** for telemetry, ids and
  timestamps — so a correlation id reads as data, not as prose.
- Panels are separated by 1px hairlines rather than by gaps and drop shadows.
  Corner radii stay small: 6px for controls, 8px for panels.
- Colour is reserved. Green, amber and red mean exactly one thing each, and the
  brass accent is used for the product's own voice, never for status.
- Glassmorphism appears only where it earns its place — the top bar and popovers —
  not as a blanket treatment over every card.
- The request trace is the centre of gravity, and everything else is arranged to
  point at it.

`npm run qa:audit` sweeps every page across five viewports in both themes and
checks text/background contrast, horizontal overflow, real hit areas (using
`elementFromPoint`, not just bounding boxes), text size, and landmark structure.
It currently reports no issues.

---

## Troubleshooting

**The bot does not reply.**
Open the matching request trace. In order of likelihood:

1. *No request was created at all* — the chat is not on the allowlist. Check
   Settings → Telegram, and that the id is the **chat** id.
2. *`Chat authorized` is missing* — the webhook is not registered, or points at a
   different deployment. Click **Check status**.
3. *`Telegram delivery failed`* — the bot was removed from the chat, or blocked.
4. *`No providers available`* — nothing is enabled, or no primary is set.

**`No database is configured.`**
A deployment reached the request path without `TURSO_DATABASE_URL`. This is
deliberate: on Vercel the filesystem is read-only, so falling back to a local
SQLite file would fail later with an opaque driver error. Add the variable to
the Vercel project and redeploy.

**`TURSO_DATABASE_URL points at a remote database but TURSO_AUTH_TOKEN is not set.`**
The token is missing or empty. Create a read-write token with
`turso db tokens create` and add it. A read-only token connects and then fails
on the first write, which surfaces as a request failure rather than a startup one.

**`Failed to fetch` / 500 on every page.**
The database is reachable but not answering. Confirm `npm run db:migrate` has
been run against that database, and that the token has write scope.

**`ENCRYPTION_KEY is not set`.**
Add it and redeploy. If it changed after secrets were saved, the old values are
unreadable — clear the bot token and provider keys and re-enter them.

**The dashboard asks for an admin key.**
`ADMIN_API_KEY` is set in the environment. Enter the same value, or unset the
variable if you did not intend the protection.

**Registered the webhook but messages still arrive via `getUpdates`.**
Telegram cannot deliver to both at once. Delete the bot's updates once with
`/deleteWebhook`, or use the dashboard's **Remove webhook** first, then register
again. The two modes are mutually exclusive.

**A provider test fails with 401 but the key looks right.**
Check for a stray space, a missing prefix (`sk-`), or that the base URL matches
the vendor's key (a Groq key will not work against OpenRouter).

**Changed the model and nothing happened.**
The per-request model comes from the provider row; the conversation-level
`temperature` and `maxTokens` in Settings only apply when the provider does not
set its own. Clear the provider's own values to inherit the global ones.

**The build warns about multiple lockfiles.**
Something above the repository has a `package-lock.json`. It is harmless — the
project pins its own `outputFileTracingRoot` — or remove the stray file.

---

## License

Private and personal. Use it, change it, keep it.
# telegram-vercel
# vercel-telegram
# vercel-telegram

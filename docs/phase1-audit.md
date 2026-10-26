# Nova.Ai — Phase 1 audit and changes (2026-10-26)

Sources: `SeeNoEvilClthng/Nova.AI` `main` (last push 2026-10-02) and the live site at nova-ai-tau-one.vercel.app. I inspected the live site signed-out only (no account was created), so authenticated screens were audited from code, not clicked through.

## Actual stack

| Layer | What it is |
|---|---|
| Hosting | Vercel. `vercel.json` routes every path to one Node function. Nitro 3 beta builds `src/index.ts`, which mounts the legacy Express app in `server.js`. `render.yaml`/`Dockerfile` are an unused alternative. |
| Frontend | Vanilla JS and CSS with no build step. 1 HTML shell, 18 JS files and about 30 CSS files, all served by the function. |
| Auth / DB | Supabase Auth (email/password). Data goes through the PostgREST API using the user's JWT, with RLS. Most app data is one `state` JSONB blob per workspace. SQLite (`node:sqlite`) is the local fallback. |
| AI | `router.js` uses Vercel AI Gateway (OIDC) or direct OpenAI. **Production currently runs the free `inclusionai/ling-3.0-tiny-free` model**, with `poolside/laguna-s-2.1-free` as fallback (from `/api/providers`). Claude and Gemini are registered but inactive. |
| Jobs | Vercel Workflow DevKit (`workflow`) for "durable missions". There is one Vercel cron (reseller campaigns, daily). |
| Billing | Stripe Checkout, Portal and a signature-verified webhook, for platform subscriptions only. |
| Integrations | Vercel Connect (GitHub, X, Meta). Instagram OAuth stores tokens encrypted with AES-256-GCM. |

## Confirmed findings (with evidence)

### Performance
1. **Every asset goes through the serverless function and is never cached at the edge.** On the live site, JS/CSS/HTML returned `Cache-Control: no-cache` and `X-Vercel-Cache: MISS`, with no `ETag`, so each visit downloaded everything again. A cold load made 48 requests, small JS files took about 1.9–2.1 s each, and FCP was about 2.95 s (one measurement from a desktop browser pane).
2. **About 25 MB of PNGs were read into memory at module load** (`server.js` `staticFiles`, product images), which inflated every cold start.
3. **AI calls are synchronous inside the request.** `/api/workforce/run` makes two model calls in sequence (orchestrator, then reviewer), with a 45 s timeout each and no streaming.
4. **Page analytics downloaded every event row to count views** (`supabase.getPageStats`). This got slower as traffic grew and was silently capped by PostgREST's 1,000-row limit, so view counts stop increasing at 1,000.
5. **The daily cron and the Instagram OAuth callback loaded every workspace's full state** (`adminListWorkspaces`) just to find one or a few workspaces.

### Trust, security and cost
6. **AI usage metering was client-side.** `app.js` `recordUsage` added up tokens in the browser and saved them with `PUT /api/state`. The server budget check read that client-written number. A user could lower it (or write to their own `nova_workspaces` row directly through the public Supabase API) and get unlimited AI spend up to the plan ceiling. Separately, **generating a new strategy reset `aiUsage` to 0** (`app.js`, the `state={...aiUsage:{...0}}` rebuild).
7. **Simulated agent activity.**
   - `workflows/nova-mission.ts` steps returned hard-coded strings ("Converted … into one measurable company mission") and made no model call.
   - Every workforce employee was forced to `status: "completed"` (JSON schema `enum:["completed"]`) and shown as "✓ Done", even though the outputs are drafts.
   - The overview's "Live Operations" card was static HTML that always said "Strategy — Working".
   - "Company health" was hard-coded to 68 or 82, and "Active agents" was always 3.
8. **Founders approved durable missions without seeing the work.** No step output reached the UI before the approval button.
9. **Durable missions skipped the entitlement and token-budget gate** (`src/index.ts`).
10. The in-memory per-IP rate limiter (`rateBuckets`) is per serverless instance, so it is largely ineffective on Vercel. *Not fixed yet.*
11. Anonymous visitors can insert `nova_page_events`/`nova_page_leads` directly through the public Supabase API, bypassing the server's rate limit, so analytics can be inflated. *Not fixed yet.*
12. The Stripe webhook doesn't dedupe event IDs or guard against out-of-order `subscription.updated` events. Upserts make this mostly harmless. *Not fixed yet.*
13. Workspace state is one JSONB blob saved last-write-wins from the browser, so concurrent tabs or jobs can overwrite each other. *Structural; see plan.*

### Working as claimed (verified in code)
RLS on all tables; Stripe signature verification; HMAC-signed execution receipts; AES-GCM-encrypted Instagram tokens; signed OAuth state; per-network publish receipts preventing double posts; and the existing 26 unit tests.

## What Phase 1 changed

| File | Change |
|---|---|
| `server.js` | Static assets get ETag + 304 handling and `s-maxage=600` edge caching (purged on every deploy). Images load lazily on first request instead of at boot. Every AI route records usage in the ledger. `PUT /api/state` can no longer lower `aiUsage`. The workforce schema and fallback use `drafted`, not `completed`. The OAuth callback does a single-row lookup and checks the owner. The cron filters in the database. A dead duplicate Instagram callback was removed. |
| `ai-usage.js` (new) | Server-authoritative usage ledger: idempotent per generation ID and never throws. Falls back to workspace state if the table is missing. |
| `ai-access.js` (new) | Shared entitlement and budget gate, now also used by durable missions. |
| `ai-budget.js` | Budget usage is `max(ledger, state)`. Adds `preserveUsage`. |
| `supabase.js` | Row counts use `HEAD` + `count=exact`, and the leads list is limited to 200. Adds the ledger insert/sum, `adminGetWorkspace` and `adminListAutomatedWorkspaces`. |
| `database.js` | Local SQLite ledger table. |
| `router.js` | Records `latencyMs` on every model call (groundwork for p50/p95). Workforce statuses are `drafted`. New `generateAgentTask` helper. |
| `mission-agents.js` (new) | Real Strategy / Research / Builder / Compliance-review agent calls for durable missions, with guardrails against claiming external actions. Output is labelled "template" when no model is available. Step results are saved to the mission record. |
| `workflows/nova-mission.ts` | Steps call the agents. Drafts are saved before the approval hook, so the founder can review them before deciding. |
| `src/index.ts` | Durable missions now require sign-in plus the entitlement and budget gate, and pass `userId`. |
| `durable-missions.js/.css` | Each step shows as "AI draft", "Template" or "Prepared · not executed". Approve/Reject appear only once the drafts are ready. |
| `app.js`, `index.html` | Live Operations card, health and active-agent counts come from real tasks and the evaluation score. Employee cards say "Drafted" or "Template draft". Regenerating a strategy no longer wipes AI usage or the budget settings. |
| `supabase/migrations/20261026_ai_usage_ledger.sql` (also appended to `schema.sql`) | `nova_ai_usage_events` table (service-role write, owner read) and the `nova_workspace_ai_tokens()` RPC. |
| `phase1.test.js`, `package.json` | 9 new tests; new modules added to `npm run check`. |

## What was tested
- `npm test`: **35/35 pass** (26 existing + 9 new) on Node 24.22.1 in local SQLite/demo-engine mode.
- `npm run check` passes. `nitro build` succeeds, and the workflow steps register in the bundle.
- **Not tested:** anything against real Supabase, AI Gateway or Vercel (no credentials here); the browser UI changes (not exercised in a signed-in session); and live latency after deploy.

## Configuration required
1. In the Supabase SQL editor, run `supabase/migrations/20261026_ai_usage_ledger.sql`. Until you do, the app logs `AI usage ledger unavailable` and falls back to state-based budgets. Nothing breaks.
2. `SUPABASE_SECRET_KEY` must be set in Vercel. It is already needed for Stripe webhooks and cron. Without it, ledger writes are skipped, and **durable missions will retry and then fail at the "save drafts" step**.
3. Recommended: switch `AI_GATEWAY_MODEL` from the free tiny model to a capable one. Output quality is currently limited by the model, not the code.

## Deploy
1. Commit the changed files on a branch and open a PR. Vercel will build a preview.
2. On the preview: sign in, generate a strategy, run the workforce, start a durable mission, and confirm the drafts appear before Approve. Then check that `select sum(total_tokens) from nova_ai_usage_events` grows.
3. Check edge caching with `curl -I <preview>/app.js` twice. Expect `etag` and `x-vercel-cache: HIT` on the second request.
4. Merge to `main`.

## Rollback
- Code: in Vercel, open Deployments, then use "Instant Rollback" on the previous production deployment. Or `git revert` the merge commit.
- Database: the migration only adds a table and a function, and old code ignores both. No rollback is needed. To remove them: `drop function public.nova_workspace_ai_tokens(uuid); drop table public.nova_ai_usage_events;`.

## Phase 1b (2026-10-27): rate limiting, visitor-write lockdown, bundling

Fixes findings 10 and 11, plus front-end request count.

| File | Change |
|---|---|
| `rate-limit.js` (new) | Rate limits shared across all server instances, stored in Postgres through the `nova_rate_limit_hit` RPC. Buckets are keyed by an HMAC of the client IP, so raw IPs are never stored. If the database is unreachable it falls back to per-instance limits, and idle in-memory buckets are pruned. |
| `server.js` | All six limited routes use the shared limiter. Optional Cloudflare Turnstile on published-page waitlists (only on when `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are both set). Boot-time bundling of HTML shells, with bundles served as `immutable`. |
| `supabase.js` | Page views and waitlist signups are written with the service role after the server's checks. Adds `rateLimitHit` and `hasSecret`. |
| `asset-bundler.js` (new) | Merges each run of consecutive local `<link rel=stylesheet>` / `<script src>` tags into one content-hashed file. CSS `@import`s are hoisted so fonts still load. The original files remain available. `NOVA_DISABLE_BUNDLING=1` turns bundling off. |
| `supabase/migrations/20261027_rate_limits_and_visitor_writes.sql` (also appended to `schema.sql`) | `nova_rate_limits` table and RPC (service role only). Revokes anonymous inserts on `nova_page_events` and `nova_page_leads`. |
| `phase2.test.js`, `package.json` | 6 new tests; new modules added to `npm run check`. |

**Tested:** `npm test` passes **41/41**. `npm run check` and `nitro build` pass. Local browser check in SQLite mode:
- The dashboard loads 2 asset files instead of 41.
- All 4 font families load.
- The Live Operations card shows real idle state.
- A workforce run completes and shows "Template draft" labels.
- The only console errors are two 401s from sign-in-only endpoints in local mode; that code is unchanged.

**Not tested:** the Supabase RPC and anon revokes against a real project, Turnstile against Cloudflare, and Vercel edge behaviour.

**Order matters when deploying 1b:** deploy the code first, then run `20261027_rate_limits_and_visitor_writes.sql`. Old code inserts visitor rows with the anonymous key, so it would stop recording signups if the migration ran first. Before the migration runs, the new code falls back to per-instance limits; visitor writes already use the service role, so they keep working. Published pages need `SUPABASE_SECRET_KEY` from this release on. To roll back the database after a code rollback, re-create the two anon insert policies and grants from the original `schema.sql`.

## Phase 2 (2026-10-28): Revenue Engine and model routing

The first complete idea-to-revenue path. A founder drafts an offer (optionally with AI), connects the company's own Stripe account, takes the offer live, and customers buy from the published launch page. Revenue counts only payments read back from Stripe.

| File | Change |
|---|---|
| `founder-stripe.js` (new) | Stripe client for the founder's own account. Accepts **restricted keys only** (`rk_test_`/`rk_live_`); full secret keys are rejected. Creates product → price (one-time or recurring) → Payment Link, with idempotency keys. Pauses or resumes links, and pages through paid Checkout Sessions including refunds. |
| `revenue-engine.js` (new) | Connect/disconnect, take an offer live (explicit confirmation on every call), pause/resume, sync (upserts by Stripe session ID, so it never double counts), the summary (gross, refunds, net, conversion), and a helper that keeps checkout details when the browser saves the workspace. |
| `revenue-routes.js` (new) | `/api/revenue/*`: status, connect, disconnect, offers/checkout, offers/active, sync, summary and **offers/draft** (AI Offer Strategist with unit-economics estimates and risks). Every route requires sign-in and workspace ownership. |
| `secret-box.js` (new) | AES-256-GCM for stored credentials. Uses `NOVA_ENCRYPTION_KEY`, or the existing `SOCIAL_TOKEN_ENCRYPTION_KEY`. |
| `server.js` | Published pages show live offers with Stripe "Buy now" buttons (Stripe-hosted URLs only) and a thank-you banner after payment. `PUT /api/state` keeps checkout details. The daily cron also syncs revenue for every connected company. |
| `router.js` | Model routing: a `fast` tier for listings and captions, a `reasoning` tier for everything else. Configured with `AI_GATEWAY_FAST_MODEL`/`AI_GATEWAY_REASONING_MODEL` (or the `OPENAI_*` equivalents); unset tiers fall back to the single model. |
| `revenue.js`, `revenue.css`, `index.html` | The Revenue screen uses real data: Stripe connect form, "Draft with AI", Go live / Copy link / Pause, Sync, an order ledger with refunds and TEST badges, and a 5-step readiness checklist. Browser-saved `state.orders` is no longer used. |
| `supabase/migrations/20261028_revenue_engine.sql` | `nova_payment_connections` (server-only) and `nova_orders` (owners can read; only the server can write). |
| `phase3.test.js` | 12 new tests (53 total). |

**Needs configuration:**
1. Run `20261028_revenue_engine.sql`.
2. Make sure `NOVA_ENCRYPTION_KEY` (or `SOCIAL_TOKEN_ENCRYPTION_KEY`) is set to 64 hex characters, and `SUPABASE_SECRET_KEY` and `APP_URL` are set.
3. Optionally set `AI_GATEWAY_FAST_MODEL` and `AI_GATEWAY_REASONING_MODEL`.

**Not yet covered:**
- ~~Subscription renewals~~: done in Phase 3. This needs `Invoices: Read` on the key; older keys still sync first payments and show a warning.
- Sync is pull-based (daily, plus the Sync button), not webhook-driven.
- Nothing has been tested against a real Stripe account.

## Phase 3 (2026-10-29): Autonomous Operator

A daily operating cycle per company:
1. Sync verified revenue.
2. Collect real metrics (revenue, traffic, signups, new leads, interviews, live offers, open/blocked tasks).
3. A CEO agent writes a brief with 3–5 recommended actions.
4. In Autopilot mode, it also drafts internal work for up to two low-risk actions.

The cycle never publishes, messages anyone, spends money or changes prices. External actions are always proposals, and the server forces `requiresApproval` on them whatever the model returns.

| File | Change |
|---|---|
| `operator.js` (new) | Mode settings (Copilot / Supervised / Autopilot, pause, daily token cap of 5k–200k), metric builder, a rule-based brief when no model is configured, action-safety enforcement, Autopilot drafting, and checks before a scheduled run (pause, active plan, AI budget). |
| `operator-runtime.js` (new) | Wires the operator to Supabase, the router, the usage ledger and revenue sync. |
| `operator-routes.js` (new) | `POST /api/operator/settings`, `GET /api/operator/runs`, `POST /api/operator/run`. Manual runs have the same entitlement and budget checks as other AI routes; they reply immediately and keep running in the background through Vercel's `waitUntil`. The existing daily cron runs eligible companies (Supervised or Autopilot, not paused, no run in the last 20 h) oldest first, within a 200 s time budget; any it doesn't reach run the next day. Every outcome, including failures, is written to the run log. |
| `server.js` | Mounts the operator routes and the scheduled cycles. `operatingMode` is server-owned: browser saves can't change the mode, pause or cap. Serves the new panel files. |
| `package.json` | `@vercel/functions` pinned to 3.9.3, the version already in the lockfile. |
| `supabase.js` | Server-side metric reads, token-use queries and the operator run log. |
| `founder-stripe.js`, `revenue-engine.js` | Subscription renewal invoices sync as orders (the first invoice is excluded so it isn't double counted). |
| `operator-panel.js`, `operator.css`, `index.html` | Autopilot screen: mode picker, token cap, Pause/Resume, Run cycle now, latest brief with a real-metrics strip, risks, actions tagged Internal or Needs your approval (each can be handed to the AI team), Autopilot drafts, and a history/audit table. |
| `supabase/migrations/20261029_operator_runs.sql` | `nova_operator_runs`: owners can read; only the server can write. |
| `phase4.test.js` | 11 new tests (64 total). |

**Production finding (pre-existing):** `vercel.json` deploys `server.js` directly, so **nothing in `src/index.ts` runs on Vercel**. That covers durable missions, tool connections and the Meta/X publish routes there; on the live site they all return 404, and that was already true before these changes. The operator was first built on Workflow DevKit inside `src/index.ts` and was moved into `server.js` because of this. Durable missions and tool connections were fixed in Phase 4 (below).

## Phase 4 (2026-10-30): durable missions that work in production

Missions are rebuilt as a saved state machine inside `server.js`:
- `running` → strategy, research and build → `awaiting_approval`.
- Approve → `executing` → prepare (not executed) and review → `completed`.
- Reject → `rejected`.
- Any stage failing 3 times → `failed`, which the founder can **Retry**.

**How it stays reliable:**
- Every step is saved the moment it finishes, so a crash or timeout resumes at the next unfinished step.
- A 5-minute lease on each mission means only one server works on it at a time.
- Steps keep running in the background after the response (Vercel `waitUntil`).
- Missions that stall are picked up again when the list is next viewed, and by the daily cron.

| File | Change |
|---|---|
| `missions.js` (new) | The state machine: start, advance (lease, per-step saves, retries), decide, retry, stall detection. |
| `mission-routes.js` (new) | `/api/durable-missions` (start, list, decision, retry) and `/api/tool-connections` (list, permissions), now served by `server.js`. |
| `background.js` (new) | Shared `waitUntil` helper, also used by the operator. |
| `supabase.js` | `nova_missions` storage: insert, RLS list/get, lease claim, update, active list. |
| `mission-store-local.js` (new), `database.js` | SQLite mission store for local development. It is loaded and its table created only on first use; `database.js` just exports its connection. |
| `server.js` | Mounts the routes **behind a load guard**: if the missions module fails to load, only `/api/durable-missions` and `/api/tool-connections` return 503, and `/api/health` reports `"status":"degraded"` with the error. The cron also resumes stalled missions. |
| `src/index.ts`, `workflows/nova-mission.ts` | Intentionally **left unchanged** (see the incident below). Their mission routes are now superseded by `server.js` and remain unreachable on Vercel, as before. |
| `durable-missions.js` | Shows the stage, the retry reason, the failure reason and a Retry button. |
| `supabase/migrations/20261030_missions.sql` | `nova_missions`: owners can read; only the server can write. |
| `phase5.test.js` | 8 new tests (72 total), including a full start → approve → complete run over HTTP. |

**Needs configuration:** run `20261030_missions.sql`.

**Incident (2026-10-30):** the first release of this change (`3ec08c7`) made every request on the live site return HTTP 500, health check included. It was reverted within about 5 minutes (`9a3d866`). The same code loads and serves normally locally with production settings, so the failure is specific to Vercel's runtime; the exact error is only in the Vercel runtime logs, which need a dashboard login.

That release changed three things at once:
- `database.js` created a new table at startup.
- The last Workflow DevKit file was deleted and `src/index.ts` edited.
- New route modules were loaded unguarded.

The re-release removes the first two and guards the third. If it fails again, the site stays up and `/api/health` shows the error.

**Needs configuration:** run `20261029_operator_runs.sql`. Scheduled cycles use the existing daily cron and `CRON_SECRET`.

## Prioritised plan for what's next (impact ÷ effort, lowest risk first)
0. ~~(E) Operating modes with audit log, caps and emergency pause~~: done in Phase 3.

## Prioritised plan for what's next (impact ÷ effort, lowest risk first)
1. ~~(A) Shared rate limiting and anonymous-write lockdown~~ and ~~(A) Bundle the front-end~~: done in 1b. ~~(B) Model routing~~ and ~~(C) Business-to-revenue path~~: done in Phase 2 (see above for gaps).
2. **(A) Minify the bundles** (whitespace and syntax only, since the classic scripts share globals) and move images to the Vercel CDN `public/` path.
3. **(B) Move missions and tasks out of the JSONB blob** into `nova_missions`/`nova_tasks` tables with explicit states (planned → queued → executing → awaiting_approval → blocked/failed → verified), idempotency keys and a dead-letter view. Run workforce generation as a durable workflow and stream progress to the UI.
4. **(B) Model routing.** Use a cheap model for listings and captions, and a reasoning model for strategy and review, with per-tenant cost from the ledger and p50/p95 dashboards from `latency_ms`.
5. **(C) One complete business-to-revenue path (services or digital product).** Intake → plan → offer → published landing page with a Stripe Payment Link on the founder's own Stripe Connect account → webhook-verified orders feeding a "verified revenue" ledger kept separate from platform billing.
6. **(D) Growth.** Consent-based email (Resend) with unsubscribe, CRM pipeline on top of `nova_page_leads`, UTM attribution.
7. **(E) Operating modes** (Copilot / Supervised / Autopilot) built on `tool-permissions.js`, with per-action limits, spend caps, an audit log and an emergency pause.

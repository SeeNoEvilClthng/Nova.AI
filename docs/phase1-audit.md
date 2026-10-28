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

**Phase 3 configuration:** run `20261029_operator_runs.sql`. Scheduled cycles use the existing daily cron and `CRON_SECRET`.

## Phase 5 (2026-10-31): Growth — attribution and approved lead follow-up

**Attribution:**
- Published launch pages keep a random visitor ID and the first UTM tags / referring site they saw. No cookies and no personal data.
- These are sent with page views and signups.
- The visitor ID is added to Stripe Buy links as `client_reference_id`, so each synced paid order is credited to the source that first brought the buyer.

**Follow-up:**
- A Sales agent drafts a short, honest follow-up to new signups. The founder edits it, then confirms the exact subject and recipient count before sending.
- Messages go through Resend. Each one states why the person is receiving it, has a signed one-click unsubscribe link (with `List-Unsubscribe` headers), and sets replies to go to the founder.
- Unsubscribed and already-contacted leads are skipped. Limits: 50 per batch, 100 per company per day. Every send is logged.

| File | Change |
|---|---|
| `attribution.js` (new) | Cleans UTM tags, visitor IDs and referrer hosts; first-touch source summary across views, signups and orders. |
| `email-outreach.js` (new) | Signed unsubscribe tokens, draft validation (strips header injection from subjects), message footer, Resend client with idempotency keys, batch limits, template fallback. |
| `growth-routes.js` (new) | `GET /api/growth/summary`, `POST /api/growth/followup/draft`, `POST /api/growth/followup/send` (signed in, confirmation required, rate limited), and the public `/u/<token>` unsubscribe page. GET only shows a button, so link scanners can't unsubscribe anyone; POST unsubscribes. Loaded behind the startup guard. |
| `server.js` | Public page script records first touch and tags Buy links; the view and signup endpoints store attribution. Mounts the growth routes. |
| `supabase.js` | Attribution, outreach and unsubscribe queries. Writes **fall back without the new columns** until the migration runs, so views, signups and revenue sync keep working. |
| `founder-stripe.js` | Synced orders keep `client_reference_id`. |
| `growth-panel.js`, `growth.css`, `index.html` | Launch Studio Growth panel: sources table (visitors, signups, signup rate, paid orders, net revenue), UTM tip, Draft follow-up, Copy, Review and send. |
| `supabase/migrations/20261031_growth.sql` | Attribution columns on page events, leads and orders; `unsubscribed_at`/`last_contacted_at` on leads; `nova_email_sends` (owners can read; only the server can write). |
| `phase6.test.js` | 9 new tests (81 total). |

**Needs configuration:**
1. Run `20261031_growth.sql`.
2. To send from Nova, create a Resend account, verify a sending domain, and set `RESEND_API_KEY` and `NOVA_EMAIL_FROM` (for example `Acme <hello@yourdomain.com>`). Without them, drafting and Copy still work.

## Phase 6 (2026-11-01): instant revenue updates

When a founder connects Stripe, or presses **Turn on instant updates**, Nova registers a webhook in the founder's own Stripe account. It listens for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded` and `invoice.paid`.
- The endpoint's signing secret is unique to that company and stored AES-256-GCM encrypted.
- Incoming events are verified against it, with a 5-minute replay window.
- A verified event triggers the existing idempotent sync in the background, rather than trusting the event body, so duplicate or out-of-order events can't corrupt the ledger.
- Bursts are capped at 120 syncs per hour per company; the daily sync catches up anything beyond that.
- Disconnecting removes the webhook from the founder's account, or tells the founder to delete it if Stripe refuses.

This needs the optional **Webhook Endpoints: Write** permission on the restricted key. Without it, or before the migration runs, the company stays on daily and manual sync, with an explanation.

| File | Change |
|---|---|
| `founder-stripe.js` | `createWebhook`, `deleteWebhook`, `verifyStripeSignature` (per-company secret), event list. |
| `revenue-engine.js` | `enableInstantUpdates`, `handleWebhook`, webhook clean-up on disconnect, `instantUpdates` in status. |
| `revenue-routes.js` | Auto-enables on connect; `POST /api/revenue/stripe/webhook`; public `POST /api/stripe/founder-webhook/<workspaceId>`. |
| `revenue.js`, `index.html` | Instant-updates status and button; updated permission list; fixed the "company?s" typo on the live Revenue screen. |
| `supabase/migrations/20261101_instant_revenue.sql` | Webhook columns on `nova_payment_connections` (server-only). |
| `phase7.test.js` | 5 new tests (86 total). |

## Phase 7 (2026-11-02): Action Center — approved actions that actually run

Each operator cycle now ends by proposing **concrete, ready-to-run actions** built from the company's real state:
- **Email N new leads:** proposed when there are new subscribed leads and email is configured. It comes with the Sales agent's drafted subject and body.
- **Take "<offer>" live:** proposed for draft offers once Stripe is connected. It includes the exact name, price and billing.

The founder reviews each one and clicks **Approve & run** or **Reject**.

On approval, the server runs it with the **same code as the manual buttons** (`sendFollowUp`, `goLiveOffer`). It then stores the provider's own IDs as evidence: Resend message IDs and the batch ID, or the Stripe payment link, product and price IDs plus the URL. It also stores an **HMAC receipt that covers a hash of the evidence**, so editing the stored proof invalidates it. The UI shows "✓ signature valid" when the receipt checks out.

**Guarantees:**
- Nothing outside Nova runs without a per-action approval; Autopilot never approves these.
- Every state change is conditional (`proposed → approved → executing → succeeded/failed`), so an action can't run twice, even if two requests race.
- At most one open action per purpose, enforced by a partial unique index.
- A failure records the reason and can be retried. Email retries only reach leads who weren't sent to, because sent leads are marked contacted.
- A proposer failure is logged as a cycle warning and never fails the cycle.

| File | Change |
|---|---|
| `actions.js` (new) | The action state machine, payload validation per kind, evidence-covering receipts, public view. |
| `action-routes.js` (new) | `GET /api/actions`, `POST /api/actions/<id>/decision`, `POST /api/actions/<id>/retry`; the executors; `proposeOperatorActions`. Loaded behind the startup guard. |
| `growth-routes.js`, `revenue-routes.js` | Extracted `draftFollowUp`/`sendFollowUp` and added `goLiveOffer`, so manual and approved actions share one code path. |
| `operator.js`, `operator-runtime.js`, `operator-panel.js` | Cycles propose actions; the brief shows how many are waiting. |
| `action-center.js`, `action-center.css`, `index.html` | Action Center panel on the Autopilot screen: previews, approve/reject, evidence, receipt status, retry. |
| `supabase.js` | Action storage, including conditional state transitions. |
| `supabase/migrations/20261102_actions.sql` | `nova_actions` (owners can read; only the server can write) with an open-action uniqueness index. |
| `phase8.test.js` | 8 new tests (94 total). |

**Needs configuration:** run `20261102_actions.sql`. Email actions need Resend to be configured (Phase 5).

## Phase 8 (2026-11-03): launch-page A/B tests with honest statistics

Founders test an alternative headline and subheading (version B, written by them or drafted by the Growth agent) against the live one (version A).

**How the test runs:**
- An early inline script splits visitors 50/50 using a stable FNV-1a hash of their random visitor ID. Each visitor always sees the same version, and the copy is swapped before it paints.
- Page views and signups are tagged with the experiment and version.
- Results are counted per version: unique visitors, unique signups, signup rate, and verified paid orders (via `client_reference_id`).

**How a winner is called:**
- Nova uses a two-sided two-proportion z-test.
- A winner is only called once each version has ≥ 100 visitors, the test has ≥ 10 signups, and p < 0.05. Before that it says "collecting"; after that, without significance, it says "no clear difference". This avoids false winners from peeking early.
- Events that try to switch a visitor's version are ignored.
- When the server finds a significant winner, the operator proposes **"Make version B your launch-page headline"** (or "keep A") in the Action Center.
- Approving it, or the founder's own "End test" button, updates the live page snapshot and the Launch Studio draft, ends the test, and records the p-value and counts as signed evidence.

**Fixes found while building this:**
- **Script injection guard.** Version-B copy embedded in the page script escapes `<`, so text such as `</script>` can't break out. This is covered by a test that runs the real page script.
- **Live bug.** `[hidden]` was being overridden by component `display` rules. On the live Revenue screen, the Stripe connect form was always visible and Cancel appeared to do nothing. A base `[hidden]{display:none!important}` rule in `styles.css` fixes this app-wide.

| File | Change |
|---|---|
| `experiments.js` (new) | Variant assignment, normal CDF, two-proportion test, results and verdicts, copy validation. |
| `experiment-routes.js` (new) | `GET/POST /api/experiments`, `POST /api/experiments/draft`, `POST /api/experiments/<id>/end`; `applyWinner`; `runningExperimentResults`. Loaded behind the startup guard. |
| `server.js` | Early variant script on public pages; loads the running test for each page view; mounts the routes. |
| `attribution.js`, `supabase.js` | Experiment/version tags on page events (dropped automatically until the migration runs); experiment storage; page snapshot update. |
| `actions.js`, `action-routes.js`, `action-center.js` | New `page_headline_update` action kind, its executor, the operator proposal, and its preview and evidence display. |
| `experiment-panel.js`, `experiment.css`, `index.html` | Launch Studio A/B test panel. |
| `styles.css` | App-wide `[hidden]` rule. |
| `supabase/migrations/20261103_experiments.sql` | `nova_experiments` (one running per page), event tag columns, updated action-kind check. |
| `phase9.test.js` | 10 new tests (104 total). |

**Needs configuration:** run `20261103_experiments.sql`.

## Prioritised plan for what's next (impact ÷ effort, lowest risk first)
Done: shared rate limiting, anonymous-write lockdown and bundling (1b); model routing and the business-to-revenue path (Phase 2); operating modes with audit log, caps and pause (Phase 3); durable missions in production (Phase 4); attribution and consent-based follow-up (Phase 5); instant revenue updates (Phase 6); Action Center with approved execution and evidence receipts (Phase 7); A/B tests with honest statistics (Phase 8).
2. **More action kinds** for the Action Center: Instagram publishing of approved campaigns, offer price changes, and mission execution steps.
3. **Port the remaining unreachable routes** (GitHub verify, X/Meta publishing) from `src/index.ts` into `server.js`, then remove `src/index.ts` behind a preview check.
5. **Minify the bundles** and move images to the Vercel CDN `public/` path.

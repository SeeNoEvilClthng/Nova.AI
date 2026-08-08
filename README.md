# Nova.Ai MVP

Local prototype for a supervised AI company-launch platform.

## Run

```bash
npm start
```

Open `http://localhost:4180`.

Workspace state is saved in a local SQLite database for development. Nova.Ai supports multiple isolated company workspaces, each with its own plan, evaluation, approvals and activity history. Runtime database files are excluded from Git.

## OpenAI provider

Nova.Ai uses OpenAI through Vercel AI Gateway in hosted deployments, authenticated with Vercel OIDC so no model key is exposed to the browser or stored in the repository. Local and non-Vercel deployments can use either `OPENAI_API_KEY` for the direct Responses API or `AI_GATEWAY_API_KEY` for the gateway. When none is configured, Nova.Ai safely falls back to its demo engine. The default model is `gpt-5.6-sol`; override it with `OPENAI_MODEL` when testing cost and latency tradeoffs.

## Provider router

`router.js` owns provider selection, contribution metadata, failure isolation, and output evaluation. OpenAI is the active Founder Agent adapter. Claude and Gemini are registered as inactive Auditor and Research adapters so they can be activated later without changing the frontend workflow.

Each launch plan is evaluated for customer clarity, offer specificity, a measurable milestone, a defined revenue model, and an independent challenge. Provider keys remain server-only.

## Supabase production setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL Editor.
3. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` on the server.
4. Restart Nova.Ai.

When configured, Nova.Ai enables email/password authentication and stores workspaces in Supabase. Every workspace query carries the signed-in user's JWT and the database enforces ownership with Row Level Security. A Supabase secret is not needed for ordinary workspace use. Without the public variables, Nova.Ai continues using local SQLite development mode.

## Stripe subscriptions

The app includes server-side hosted Checkout, Customer Portal, webhook verification and Supabase-backed subscription entitlements for Starter ($29/month), Builder ($79/month) and Operator ($199/month).

Copy the names in `.env.example` into `.env` and provide test-mode Stripe values. Billing remains visibly disabled until a Stripe test secret and at least one test price ID are configured. `SUPABASE_SECRET_KEY` is required only on the server so verified Stripe webhooks can update entitlements; it is never returned by `/api/config` or included in frontend code.

For local webhook testing, forward these events to `http://localhost:4180/api/stripe/webhook`:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

Keep live-mode keys and prices out of local development until the complete signup, renewal, cancellation and failed-payment flows pass in test mode.

## Publishing and waitlists

Approved Launch Studio drafts can be published to `/p/<company-slug>`. Publishing stores a public snapshot rather than exposing private workspace state. Visitors can join a waitlist, while founders can see visits, signups and conversion rate in Launch Studio or unpublish the page immediately.

Public pages and anonymous form submissions are protected with separate Supabase RLS policies. Before production deployment, add CAPTCHA or edge rate limiting to the waitlist and analytics endpoints, then configure the deployed `APP_URL`.

## Production deployment

Nova.Ai includes a production container and `render.yaml`. Configure the environment variables marked `sync: false` in the hosting provider rather than committing them. Production startup refuses missing Supabase settings or a non-HTTPS `APP_URL`; `/api/health` is available for deployment health checks. Public waitlist and analytics routes include baseline per-IP rate limits. Add managed CAPTCHA before a broad public launch.

-- Instant revenue updates: the webhook Nova registers in each founder's own
-- Stripe account, with its signing secret encrypted by the Nova server
-- (AES-256-GCM). The table stays server-only. Safe to run more than once.
alter table public.nova_payment_connections
  add column if not exists webhook_endpoint_id text,
  add column if not exists webhook_secret_enc text,
  add column if not exists webhook_iv text,
  add column if not exists webhook_tag text;

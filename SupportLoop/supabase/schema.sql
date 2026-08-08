-- Run this in the Supabase SQL editor once per project.
-- Two tables, one Postgres. Both are written only by the server (service role).

create extension if not exists "pgcrypto";

create table if not exists public.call_feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- 'voice' = the agent filed it mid-call. 'web' = someone used the fallback form.
  source text not null default 'web'
    check (source in ('voice', 'web')),
  -- What the caller was asking about, in the agent's words. Free text on purpose: the
  -- data source is owned by another component and its vocabulary is not ours to pin.
  topic text,
  -- ElevenLabs conversation id. The post-call webhook joins on this.
  conversation_id text,
  note text not null,
  caller_contact text,
  transcript jsonb,
  transcript_received_at timestamptz,
  status text not null default 'new'
    check (status in ('new', 'ticketed', 'resolved'))
);

create index if not exists call_feedback_conversation_id_idx
  on public.call_feedback (conversation_id);

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  feedback_id uuid not null references public.call_feedback (id) on delete cascade,
  linear_issue_id text,
  linear_identifier text,
  linear_url text,
  assignee text,
  devin_session_url text
);

create index if not exists tickets_feedback_id_idx on public.tickets (feedback_id);

-- No anon access: every read and write goes through the Next.js server with the
-- service role key, so RLS stays on with no policies.
alter table public.call_feedback enable row level security;
alter table public.tickets enable row level security;

-- Escalation is deliberately not a column here. Whether Devin could resolve a ticket is
-- Linear's fact, read live by /triage from the `needs-engineer` label; a copy in this
-- table would be a second source of truth that silently drifts out of date.

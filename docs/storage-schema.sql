create extension if not exists pgcrypto;

create table sources (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('twitch', 'kick', 'x')),
  source_channel_id text,
  source_name text not null,
  display_label text not null,
  created_at timestamptz not null default now(),
  unique (platform, source_channel_id)
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  mode text not null check (mode in ('fixture', 'connectors', 'replay')),
  started_at timestamptz not null,
  ended_at timestamptz,
  ingest_version text not null default 'v1',
  metadata jsonb not null default '{}'::jsonb
);

create table connector_runs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  source_id uuid references sources(id) on delete set null,
  platform text not null check (platform in ('twitch', 'kick', 'x')),
  state text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  event_count integer not null default 0,
  dropped_count integer not null default 0,
  reconnect_count integer not null default 0,
  last_event_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb
);

create table events (
  id text primary key,
  session_id uuid not null references sessions(id) on delete cascade,
  source_id uuid references sources(id) on delete set null,
  platform text not null check (platform in ('twitch', 'kick', 'x')),
  kind text not null,
  platform_event_id text not null,
  source_channel_id text,
  source_channel_name text,
  author_id text,
  author_name text,
  text text,
  occurred_at timestamptz not null,
  received_at timestamptz not null,
  signal_score integer not null default 0,
  badges jsonb not null default '[]'::jsonb,
  fragments jsonb not null default '[]'::jsonb,
  raw jsonb not null,
  unique (platform, platform_event_id)
);

create index events_session_received_at_idx on events (session_id, received_at desc);
create index events_platform_received_at_idx on events (platform, received_at desc);
create index events_source_channel_idx on events (platform, source_channel_id);
create index connector_runs_session_platform_idx on connector_runs (session_id, platform);

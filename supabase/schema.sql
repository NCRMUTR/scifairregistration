-- Sci-Tech Pitching — multi-year registration + gallery   (schema v2)
-- Run order: schema.sql -> functions.sql -> rls.sql -> storage.sql -> seed.sql
-- Target: Supabase (PostgreSQL 15+). Run in the SQL editor or via `supabase db push`.
--
-- Concept: the site lives for many years. Each year is an EDITION (รอบการจัด). Teams, members, upload slots
-- and the registration window belong to one edition; the gallery is permanent and grouped by edition/year.
-- Exactly one edition is "current" (the one visitors register for).

create extension if not exists pgcrypto with schema extensions;

-- Who may administer. Add rows by hand after creating the user in Supabase Auth.
create table public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Site-wide content that does not change per year (logo, footer, button labels …).
create table public.site_settings (
  key        text primary key,
  value      jsonb not null,
  is_public  boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.editions (
  id            uuid primary key default gen_random_uuid(),
  year          integer not null unique check (year between 2000 and 2200),
  title         text not null,                       -- e.g. "Sci-Tech Pitching 2026"
  subtitle      text not null default '',
  intro_text    text not null default '',
  background_path text,                              -- bucket public-assets
  rules_pdf_path  text,                              -- bucket public-assets
  ack_text      text not null default '',
  pdpa_text     text not null default '',
  key_dates     jsonb not null default '[]'::jsonb,  -- [{"label":"ปิดรับสมัคร","date":"2026-12-15"}, …] shown on home
  max_members   integer not null default 7 check (max_members between 1 and 20),
  -- Registration window, set by admin:
  --   reg_mode 'auto'   : open from registration_opens_at until registration_closes_at (null close = no end)
  --   reg_mode 'open'   : forced open   (manual override)
  --   reg_mode 'closed' : forced closed (manual override)
  reg_mode      text not null default 'closed' check (reg_mode in ('auto', 'open', 'closed')),
  registration_opens_at  timestamptz,
  registration_closes_at timestamptz,
  ref_prefix    text not null,                       -- e.g. 'ST26'
  ref_counter   integer not null default 0,
  is_current    boolean not null default false,
  status        text not null default 'active' check (status in ('draft', 'active', 'archived')),
  last_backup_at timestamptz,                        -- set when admin completes an export
  purged_at     timestamptz,
  purge_mode    text check (purge_mode in ('anonymize', 'delete')),
  created_at    timestamptz not null default now(),
  check (registration_closes_at is null or registration_opens_at is null or registration_closes_at > registration_opens_at)
);
create unique index editions_one_current on public.editions (is_current) where is_current;

create table public.teams (
  id          uuid primary key default gen_random_uuid(),
  edition_id  uuid not null references public.editions (id) on delete restrict,
  ref_no      text not null unique,
  name_th     text not null check (char_length(btrim(name_th)) between 1 and 120),
  name_en     text not null check (char_length(btrim(name_en)) between 1 and 120),
  -- lookup key: lower-case, single spaces. Unique PER EDITION.
  name_en_key text generated always as (lower(regexp_replace(btrim(name_en), '\s+', ' ', 'g'))) stored,
  pin_hash    text not null,                      -- bcrypt via crypt(); never store the raw PIN
  status      text not null default 'pending' check (status in ('pending', 'approved')),
  members_count_at_purge integer,                 -- kept after an "anonymize" purge for statistics
  created_at  timestamptz not null default now(),
  constraint teams_edition_name_key unique (edition_id, name_en_key),
  constraint teams_id_edition_key   unique (id, edition_id)
);

create table public.members (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null,
  edition_id uuid not null,
  order_no   smallint not null check (order_no between 1 and 20),  -- real maximum = editions.max_members
  student_id text not null check (student_id ~ '^[0-9]{13}$'),
  full_name  text not null check (char_length(btrim(full_name)) > 0),
  phone      text not null check (phone ~ '^0[0-9]{9}$'),
  constraint members_team_fk foreign key (team_id, edition_id)
             references public.teams (id, edition_id) on delete cascade,
  -- THE rule: within one edition, one student = one team. (A student may apply again next year.)
  constraint members_edition_student_key unique (edition_id, student_id),
  constraint members_team_order_key unique (team_id, order_no)
);

create table public.advisors (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams (id) on delete cascade,
  full_name  text not null check (char_length(btrim(full_name)) > 0),
  department text not null check (char_length(btrim(department)) > 0),  -- สาขา
  faculty    text not null check (char_length(btrim(faculty)) > 0)      -- คณะ
);

-- PDPA evidence: which wording the team accepted, and when.
create table public.consents (
  team_id           uuid primary key references public.teams (id) on delete cascade,
  ack_text_version  text not null,   -- md5 of the acknowledgement text at submit time
  pdpa_text_version text not null,   -- md5 of the PDPA text at submit time
  accepted_at       timestamptz not null default now()
);

create table public.upload_slots (
  id          uuid primary key default gen_random_uuid(),
  edition_id  uuid not null references public.editions (id) on delete cascade,
  title       text not null,
  description text not null default '',
  accept      text[] not null default '{pdf}',   -- allowed extensions, lower-case, no dot
  max_mb      integer not null default 10 check (max_mb between 1 and 50),
  deadline    timestamptz,
  is_open     boolean not null default false,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

create table public.uploads (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams (id) on delete cascade,
  slot_id     uuid not null references public.upload_slots (id) on delete cascade,
  file_path   text not null,      -- path inside the private bucket `team-files`
  file_name   text not null,
  size_bytes  bigint not null check (size_bytes > 0),
  uploaded_at timestamptz not null default now(),
  constraint uploads_team_slot_key unique (team_id, slot_id)   -- re-upload replaces
);

-- One-way note from a team to the committee.
create table public.messages (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at    timestamptz
);

-- Gallery (permanent, grouped by edition). An album either holds uploaded photos or links to an external album.
create table public.gallery_albums (
  id           uuid primary key default gen_random_uuid(),
  edition_id   uuid not null references public.editions (id) on delete cascade,
  title        text not null check (char_length(btrim(title)) > 0),
  description  text not null default '',
  event_date   date,
  external_url text check (external_url is null or external_url ~* '^https://'),
  cover_photo_id uuid,                            -- set by admin; falls back to first photo
  sort_order   integer not null default 0,
  is_published boolean not null default false,
  created_at   timestamptz not null default now()
);

create table public.gallery_photos (
  id         uuid primary key default gen_random_uuid(),
  album_id   uuid not null references public.gallery_albums (id) on delete cascade,
  path       text not null,        -- bucket `gallery`, resized copy (long edge <= 2000 px, made in the browser)
  thumb_path text not null,        -- bucket `gallery`, ~480 px copy
  caption    text not null default '',
  width      integer,
  height     integer,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.gallery_albums
  add constraint gallery_albums_cover_fk foreign key (cover_photo_id)
  references public.gallery_photos (id) on delete set null;

-- Every export (backup) an admin completes in the browser; the purge guard reads editions.last_backup_at.
create table public.backup_log (
  id         bigserial primary key,
  edition_id uuid not null references public.editions (id) on delete cascade,
  admin_id   uuid,
  counts     jsonb not null default '{}'::jsonb,   -- {"teams":12,"members":70,"files":30,…}
  at         timestamptz not null default now()
);

create table public.audit_log (
  id       bigserial primary key,
  admin_id uuid,
  action   text not null,
  target   text,
  detail   jsonb,
  at       timestamptz not null default now()
);

-- Brute-force protection for PIN lookups (written only by SECURITY DEFINER functions).
create table public.lookup_attempts (
  key          text primary key,            -- "<year>:<normalised English team name>"
  fails        integer not null default 0,
  window_start timestamptz not null default now(),
  locked_until timestamptz
);

-- Per-IP call counters for public RPCs.
create table public.rate_limits (
  bucket       text not null,
  ip           text not null,
  window_start timestamptz not null default now(),
  hits         integer not null default 0,
  primary key (bucket, ip)
);

create index teams_edition_idx    on public.teams (edition_id);
create index members_team_idx     on public.members (team_id);
create index advisors_team_idx    on public.advisors (team_id);
create index uploads_team_idx     on public.uploads (team_id);
create index messages_team_idx    on public.messages (team_id);
create index slots_edition_idx    on public.upload_slots (edition_id);
create index albums_edition_idx   on public.gallery_albums (edition_id, sort_order);
create index photos_album_idx     on public.gallery_photos (album_id, sort_order);
create index audit_log_at_idx     on public.audit_log (at desc);

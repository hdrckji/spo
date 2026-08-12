-- ============================================================
--  Instants Réflexo — schéma de la base de réservation
--  À exécuter une fois sur la base Neon (console SQL ou psql).
--  Le script est idempotent : le rejouer ne casse rien.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
--  Réservations
-- ------------------------------------------------------------
create table if not exists bookings (
  id            uuid primary key default gen_random_uuid(),
  booking_date  date        not null,
  slot          text        not null,
  session_type  text        not null,
  price_cents   integer     not null,
  name          text        not null,
  email         text        not null,
  phone         text,
  message       text,
  status        text        not null default 'confirmed',
  cancel_token  text        not null,
  ip_hash       text,
  -- Incrémenté à chaque déplacement. Sert de SEQUENCE iCalendar : c'est ce
  -- qui permet aux applications de calendrier de *mettre à jour* le
  -- rendez-vous existant au lieu d'en créer un second.
  revision      integer     not null default 0,
  created_at    timestamptz not null default now(),
  cancelled_at  timestamptz,

  constraint bookings_session_type_check
    check (session_type in ('classique', 'personnalisee')),
  constraint bookings_status_check
    check (status in ('pending', 'confirmed', 'cancelled'))
);

-- Le cœur du système anti-double-réservation.
-- Un seul rendez-vous vivant par (date, créneau) : une seconde insertion
-- concurrente échoue avec le code Postgres 23505, que l'API traduit en 409.
-- Les réservations annulées sont exclues, ce qui libère le créneau.
create unique index if not exists one_booking_per_slot
  on bookings (booking_date, slot)
  where status in ('pending', 'confirmed');

-- Lecture des disponibilités sur une fenêtre de dates.
create index if not exists bookings_date_idx
  on bookings (booking_date)
  where status in ('pending', 'confirmed');

-- Recherche par lien d'annulation.
create index if not exists bookings_cancel_token_idx
  on bookings (cancel_token);

-- Ajout de colonne pour les bases créées avant cette version : `create table
-- if not exists` ne touche pas une table déjà présente, cet ALTER si.
alter table bookings add column if not exists revision integer not null default 0;

-- ------------------------------------------------------------
--  Dates bloquées (congés, absences)
-- ------------------------------------------------------------
create table if not exists blocked_dates (
  blocked_date date primary key,
  reason       text,
  created_at   timestamptz not null default now()
);

-- ------------------------------------------------------------
--  Limitation de débit : trace des tentatives de réservation
--  Seul un hachage de l'IP est conservé, jamais l'IP en clair.
-- ------------------------------------------------------------
create table if not exists reserve_attempts (
  id         bigserial primary key,
  ip_hash    text        not null,
  created_at timestamptz not null default now()
);

create index if not exists reserve_attempts_lookup_idx
  on reserve_attempts (ip_hash, created_at desc);

-- ------------------------------------------------------------
--  Purge RGPD — limitation de la durée de conservation.
--  Appelée par le cron quotidien (voir api/cron/purge.js).
-- ------------------------------------------------------------
create or replace function purge_old_data(retention_months integer default 12)
returns table (deleted_bookings bigint, deleted_attempts bigint)
language plpgsql
as $$
declare
  b bigint;
  a bigint;
begin
  delete from bookings
   where booking_date < (current_date - (retention_months || ' months')::interval);
  get diagnostics b = row_count;

  delete from reserve_attempts
   where created_at < now() - interval '7 days';
  get diagnostics a = row_count;

  return query select b, a;
end;
$$;

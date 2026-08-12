-- ============================================================
--  Instants Réflexo — schéma de la base de réservation
--
--  FICHIER GÉNÉRÉ — ne le modifiez pas à la main.
--  Source : api/_lib/schema.js · régénérer avec `npm run schema:sql`
--
--  Vous n'avez normalement pas à l'exécuter : le schéma se met à niveau
--  tout seul au premier appel suivant un déploiement (api/_lib/migrate.js).
--  Il reste là pour relire le schéma ou repartir d'une base vierge.
--
--  Version du schéma : 2
--  Le script est idempotent : le rejouer ne casse rien.
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists schema_meta (
  key        text primary key,
  value      text        not null,
  updated_at timestamptz not null default now()
);

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
  revision      integer     not null default 0,
  created_at    timestamptz not null default now(),
  cancelled_at  timestamptz,

  constraint bookings_session_type_check
    check (session_type in ('classique', 'personnalisee')),
  constraint bookings_status_check
    check (status in ('pending', 'confirmed', 'cancelled'))
);

alter table bookings add column if not exists revision integer not null default 0;

create unique index if not exists one_booking_per_slot
  on bookings (booking_date, slot)
  where status in ('pending', 'confirmed');

create index if not exists bookings_date_idx
  on bookings (booking_date)
  where status in ('pending', 'confirmed');

create index if not exists bookings_cancel_token_idx
  on bookings (cancel_token);

create table if not exists blocked_dates (
  blocked_date date primary key,
  reason       text,
  created_at   timestamptz not null default now()
);

create table if not exists reserve_attempts (
  id         bigserial primary key,
  ip_hash    text        not null,
  created_at timestamptz not null default now()
);

create index if not exists reserve_attempts_lookup_idx
  on reserve_attempts (ip_hash, created_at desc);

create or replace function purge_old_data(retention_months integer default 12)
returns table (deleted_bookings bigint, deleted_attempts bigint)
language plpgsql
as $fn$
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
$fn$;

insert into schema_meta (key, value, updated_at)
values ('version', '2', now())
on conflict (key) do update
  set value = excluded.value, updated_at = now();

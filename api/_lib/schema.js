/**
 * Schéma de la base — source unique de vérité.
 *
 * Ce fichier est lu par deux consommateurs :
 *   - api/_lib/migrate.js, qui l'applique tout seul au démarrage à froid ;
 *   - scripts/generate-schema-sql.mjs, qui en produit db/schema.sql pour
 *     ceux qui préfèrent l'appliquer à la main.
 *
 * Ne modifiez jamais db/schema.sql directement : il est régénéré. Ajoutez la
 * nouvelle instruction ici, puis incrémentez SCHEMA_VERSION.
 *
 * Chaque instruction doit être idempotente — `if not exists`, `or replace`,
 * `add column if not exists`. Elles sont rejouées telles quelles sur une base
 * déjà en place.
 */

/** À incrémenter à chaque ajout d'instruction. Déclenche la migration. */
export const SCHEMA_VERSION = 3;

/**
 * Verrou consultatif Postgres. Deux fonctions qui démarrent à froid en même
 * temps migreraient sinon simultanément — Postgres tolère mal le DDL
 * concurrent, même idempotent. La seconde attend ici, puis rejoue les mêmes
 * instructions sans effet.
 */
export const MIGRATION_LOCK = 8127354091;

export const STATEMENTS = [
  `create extension if not exists pgcrypto`,

  // Journal de version : permet aux démarrages suivants de sauter la migration.
  `create table if not exists schema_meta (
     key        text primary key,
     value      text        not null,
     updated_at timestamptz not null default now()
   )`,

  /* ---------- Réservations ---------- */
  `create table if not exists bookings (
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
   )`,

  // Pour les bases créées avant l'ajout de la colonne : `create table if not
  // exists` ne touche pas une table existante, cet ALTER si.
  `alter table bookings add column if not exists revision integer not null default 0`,

  // Le cœur du système anti-double-réservation. Un seul rendez-vous vivant
  // par (date, créneau) : une insertion ou un déplacement concurrent échoue
  // en 23505, que l'API traduit en 409. Les annulations libèrent le créneau.
  `create unique index if not exists one_booking_per_slot
     on bookings (booking_date, slot)
     where status in ('pending', 'confirmed')`,

  `create index if not exists bookings_date_idx
     on bookings (booking_date)
     where status in ('pending', 'confirmed')`,

  `create index if not exists bookings_cancel_token_idx
     on bookings (cancel_token)`,

  /* ---------- Congés ---------- */
  `create table if not exists blocked_dates (
     blocked_date date primary key,
     reason       text,
     created_at   timestamptz not null default now()
   )`,

  /* ---------- Limitation de débit ----------
     Seul un hachage de l'adresse IP est conservé, jamais l'IP en clair. */
  `create table if not exists reserve_attempts (
     id         bigserial primary key,
     ip_hash    text        not null,
     created_at timestamptz not null default now()
   )`,

  `create index if not exists reserve_attempts_lookup_idx
     on reserve_attempts (ip_hash, created_at desc)`,

  /* ---------- Tentatives d'accès à l'administration ----------
     C'est ce qui rend sûr un ADMIN_TOKEN court : au-delà de quelques échecs
     par quart d'heure et par adresse, l'accès est refusé. Là encore, seul un
     hachage de l'IP est conservé. */
  `create table if not exists admin_attempts (
     id         bigserial primary key,
     ip_hash    text        not null,
     created_at timestamptz not null default now()
   )`,

  `create index if not exists admin_attempts_lookup_idx
     on admin_attempts (ip_hash, created_at desc)`,

  /* ---------- Purge RGPD ----------
     Appelée par le cron quotidien (api/cron/purge.js). */
  `create or replace function purge_old_data(retention_months integer default 12)
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

     delete from admin_attempts
      where created_at < now() - interval '7 days';

     return query select b, a;
   end;
   $fn$`,
];

/**
 * Migration automatique du schéma.
 *
 * Le déploiement ne demande plus d'ouvrir la console SQL : au premier appel
 * qui touche la base après une mise en ligne, le schéma se met à niveau tout
 * seul. Une table `schema_meta` retient la version appliquée, si bien que les
 * appels suivants ne coûtent qu'une lecture — et rien du tout une fois la
 * fonction chaude.
 *
 * Ce raccourci se justifie ici par l'échelle : une praticienne, une vingtaine
 * de rendez-vous par mois, un seul déploiement à la fois. Sur un projet où
 * plusieurs personnes livrent en parallèle, un vrai outil de migration
 * versionnée resterait préférable.
 */

import { sql } from "./db.js";
import { MIGRATION_LOCK, SCHEMA_VERSION, STATEMENTS } from "./schema.js";

/** Mémorisé pour la durée de vie du processus : une seule migration par instance. */
let pending = null;

export function ensureSchema() {
  if (!pending) {
    pending = migrate().catch((err) => {
      // Un échec ne doit pas geler définitivement l'instance : la tentative
      // suivante rejouera la migration.
      pending = null;
      throw err;
    });
  }
  return pending;
}

async function migrate() {
  if (await isUpToDate()) return;

  const started = Date.now();

  // Tout dans une seule transaction, précédée d'un verrou consultatif : deux
  // instances qui démarrent en même temps ne peuvent pas exécuter le DDL
  // simultanément. La seconde attend, puis rejoue des instructions sans effet.
  await sql.transaction((txn) => [
    txn.query(`select pg_advisory_xact_lock($1::bigint)`, [MIGRATION_LOCK]),
    ...STATEMENTS.map((statement) => txn.query(statement)),
    txn.query(
      `insert into schema_meta (key, value, updated_at)
       values ('version', $1, now())
       on conflict (key) do update
         set value = excluded.value, updated_at = now()`,
      [String(SCHEMA_VERSION)]
    ),
  ]);

  console.log(`[migrate] schéma porté en version ${SCHEMA_VERSION} (${Date.now() - started} ms)`);
}

async function isUpToDate() {
  try {
    const rows = await sql.query(`select value from schema_meta where key = 'version'`);
    return rows.length > 0 && Number(rows[0].value) >= SCHEMA_VERSION;
  } catch {
    // `schema_meta` n'existe pas encore : c'est la toute première migration.
    return false;
  }
}

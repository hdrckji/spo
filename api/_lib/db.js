/**
 * Accès à la base Neon (Postgres) via le driver HTTP serverless.
 *
 * Le driver HTTP est indispensable ici : une fonction Vercel est éphémère
 * et un pool TCP classique épuiserait les connexions de la base.
 */

import { neon } from "@neondatabase/serverless";

/** Code Postgres d'une violation de contrainte d'unicité. */
export const UNIQUE_VIOLATION = "23505";

let client = null;

/** Création paresseuse : rien ne se connecte tant qu'aucune requête n'est faite. */
function getClient() {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL n'est pas configurée. Voir README.md pour le provisionnement de la base."
      );
    }
    client = neon(url);
  }
  return client;
}

/**
 * Client SQL, sous forme de fonction à template balisé :
 *   const rows = await sql`select * from bookings where id = ${id}`;
 * Les valeurs interpolées sont toujours envoyées comme paramètres liés,
 * jamais concaténées — pas d'injection SQL possible.
 */
export function sql(...args) {
  return getClient()(...args);
}

/**
 * Les méthodes du client doivent être reportées explicitement sur cette
 * enveloppe : `sql` est une fonction à nous, pas le client Neon lui-même.
 * Les oublier fait échouer l'appel à l'exécution seulement — c'est ce qui
 * est arrivé à `sql.transaction`, invisible en test parce que la fausse base
 * définissait, elle, les deux méthodes.
 */

/** Requête à partir d'une chaîne brute, avec paramètres `$1`, `$2`… */
sql.query = (queryWithPlaceholders, params, opts) =>
  getClient().query(queryWithPlaceholders, params, opts);

/** Plusieurs requêtes dans une seule transaction Postgres. */
sql.transaction = (queriesOrFn, opts) => getClient().transaction(queriesOrFn, opts);

/** Fragment SQL non échappé — réservé à des valeurs sous notre contrôle. */
sql.unsafe = (rawSQL) => getClient().unsafe(rawSQL);

/** La base est-elle configurée ? Permet de répondre proprement plutôt que de planter. */
export function isConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

/** Vrai si l'erreur est une collision sur l'index `one_booking_per_slot`. */
export function isSlotTaken(err) {
  return err?.code === UNIQUE_VIOLATION;
}

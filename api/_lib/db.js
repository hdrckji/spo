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

/**
 * Client SQL, sous forme de fonction à template balisé :
 *   const rows = await sql`select * from bookings where id = ${id}`;
 * Les valeurs interpolées sont toujours envoyées comme paramètres liés,
 * jamais concaténées — pas d'injection SQL possible.
 */
export function sql(...args) {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL n'est pas configurée. Voir README.md pour le provisionnement de la base."
      );
    }
    client = neon(url);
  }
  return client(...args);
}

/** La base est-elle configurée ? Permet de répondre proprement plutôt que de planter. */
export function isConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

/** Vrai si l'erreur est une collision sur l'index `one_booking_per_slot`. */
export function isSlotTaken(err) {
  return err?.code === UNIQUE_VIOLATION;
}

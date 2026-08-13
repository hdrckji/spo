/**
 * Limitation des tentatives d'accès à l'administration.
 *
 * C'est cette pièce qui permet d'utiliser un mot de passe retenable sans
 * exposer l'agenda. Un secret long résiste au devinage parce qu'il y a trop
 * de combinaisons à parcourir ; un secret court y résiste parce qu'on n'a
 * pas le droit d'essayer souvent.
 *
 * À cinq essais par quart d'heure, parcourir les combinaisons d'un mot de
 * passe de huit caractères prendrait un temps sans rapport avec la durée
 * d'une vie. La limite vaut par adresse IP : quelqu'un qui sature le compteur
 * ne peut pas verrouiller Patricia hors de son propre agenda.
 */

import { sql } from "./db.js";

/** Échecs tolérés par fenêtre et par adresse IP. */
export const MAX_ADMIN_FAILURES = 5;

/** Durée de la fenêtre glissante, en minutes. */
export const WINDOW_MINUTES = 15;

/**
 * Délai ajouté à chaque échec. Rend le devinage automatisé pénible sans être
 * perceptible par quelqu'un qui se trompe une fois.
 */
export const FAILURE_DELAY_MS = 400;

export function pause(ms = FAILURE_DELAY_MS) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Nombre d'échecs récents pour cette adresse. */
export async function recentFailures(ipHash) {
  const [row] = await sql`
    select count(*)::int as count
      from admin_attempts
     where ip_hash = ${ipHash}
       and created_at > now() - (${WINDOW_MINUTES} || ' minutes')::interval
  `;
  return row.count;
}

export async function recordFailure(ipHash) {
  await sql`insert into admin_attempts (ip_hash) values (${ipHash})`;
}

/** Une connexion réussie efface l'ardoise : se tromper puis réussir ne pénalise pas. */
export async function clearFailures(ipHash) {
  await sql`delete from admin_attempts where ip_hash = ${ipHash}`;
}

/**
 * Limitation des tentatives d'accès à l'administration.
 *
 * C'est ce qui permet d'utiliser un mot de passe court sans exposer l'agenda.
 * Un secret long résiste au devinage parce qu'il y a trop de combinaisons ;
 * un secret court y résiste parce qu'on n'a pas le droit d'essayer souvent.
 *
 * Avec 5 essais par quart d'heure et par adresse IP, un mot de passe de
 * 8 caractères demanderait des milliards d'années à deviner en ligne. La
 * limite vaut par IP, ce qui évite qu'un attaquant verrouille Patricia hors
 * de son propre agenda en saturant volontairement le compteur.
 */

import { sql } from "./db.js";

/** Échecs tolérés par fenêtre et par adresse IP. */
export const MAX_ADMIN_FAILURES = 5;

/** Durée de la fenêtre glissante, en minutes. */
export const WINDOW_MINUTES = 15;

/**
 * Ralentit chaque échec. Rend le devinage automatisé pénible sans que ce
 * soit perceptible pour quelqu'un qui se trompe une fois.
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

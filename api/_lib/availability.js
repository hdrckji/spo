/**
 * Calcul des disponibilités.
 *
 * La disponibilité n'est pas une lecture de table mais une *composition* de
 * sources :
 *
 *     occupé = réservations vivantes ∪ dates bloquées ∪ délai de prévenance
 *
 * Le jour où un agenda externe (Google, CalDAV) doit être pris en compte,
 * il s'ajoute à cette liste sans rien réécrire ailleurs.
 */

import {
  MIN_NOTICE_HOURS,
  SLOTS,
  TYPES,
  longLabel,
  nextFridays,
  shortLabel,
  slotInstants,
} from "./config.js";
import { sql } from "./db.js";

/**
 * @param {object}  [options]
 * @param {number}  [options.minNoticeHours] délai de prévenance. Le public est
 *   soumis à MIN_NOTICE_HOURS ; l'administration passe 0, Patricia devant
 *   pouvoir déplacer un rendez-vous vers demain matin si nécessaire.
 * @returns {Promise<{types: object, slots: Array, days: Array}>}
 */
export async function getAvailability({ minNoticeHours = MIN_NOTICE_HOURS } = {}) {
  const dates = nextFridays();
  const first = dates[0];
  const last = dates[dates.length - 1];

  // `to_char` plutôt que la colonne brute : le driver convertirait un `date`
  // en objet Date interprété dans le fuseau du serveur, ce qui réintroduirait
  // exactement le décalage d'un jour qu'on cherche à éliminer.
  const [booked, blocked] = await Promise.all([
    sql`
      select to_char(booking_date, 'YYYY-MM-DD') as day, slot
        from bookings
       where status in ('pending', 'confirmed')
         and booking_date between ${first}::date and ${last}::date
    `,
    sql`
      select to_char(blocked_date, 'YYYY-MM-DD') as day, reason
        from blocked_dates
       where blocked_date between ${first}::date and ${last}::date
    `,
  ]);

  const takenByDay = new Map();
  for (const row of booked) {
    if (!takenByDay.has(row.day)) takenByDay.set(row.day, new Set());
    takenByDay.get(row.day).add(row.slot);
  }

  const blockedByDay = new Map(blocked.map((row) => [row.day, row.reason]));

  const cutoff = Date.now() + minNoticeHours * 3_600_000;

  const days = dates.map((date) => {
    const taken = takenByDay.get(date) ?? new Set();
    const isBlocked = blockedByDay.has(date);

    const slots = SLOTS.map((slot) => {
      const { start } = slotInstants(date, slot.id);
      const tooSoon = start.getTime() < cutoff;
      return {
        id: slot.id,
        available: !isBlocked && !tooSoon && !taken.has(slot.id),
        reason: isBlocked ? "blocked" : tooSoon ? "too-soon" : taken.has(slot.id) ? "taken" : null,
      };
    });

    return {
      date,
      label: longLabel(date),
      shortLabel: shortLabel(date),
      blocked: isBlocked,
      available: slots.some((s) => s.available),
      slots,
    };
  });

  return {
    types: Object.values(TYPES),
    slots: SLOTS,
    minNoticeHours,
    days,
  };
}

/**
 * Revalidation d'une demande avant enregistrement ou déplacement.
 *
 * Les mêmes règles s'appliquent au public et à l'administration — type de
 * séance compatible avec le créneau, date proposée, journée non bloquée —
 * à l'exception du délai de prévenance, que l'administration ignore.
 *
 * @returns {{ok: true} | {ok: false, status: number, error: string}}
 */
export async function validateRequest({ date, slot, type, minNoticeHours = MIN_NOTICE_HOURS }) {
  if (!TYPES[type]) {
    return { ok: false, status: 400, error: "Type de séance inconnu." };
  }
  const slotDef = SLOTS.find((s) => s.id === slot);
  if (!slotDef) {
    return { ok: false, status: 400, error: "Créneau inconnu." };
  }
  if (type === "personnalisee" && !slotDef.perso) {
    return {
      ok: false,
      status: 400,
      error: "La séance personnalisée n'est proposée qu'à 10h30 et 16h00.",
    };
  }
  if (!nextFridays().includes(date)) {
    return { ok: false, status: 400, error: "Cette date n'est pas proposée à la réservation." };
  }

  const { start } = slotInstants(date, slot);
  if (start.getTime() < Date.now() + minNoticeHours * 3_600_000) {
    return {
      ok: false,
      status: 409,
      error: `Les réservations se font au moins ${minNoticeHours} heures à l'avance.`,
    };
  }

  const blocked = await sql`
    select 1 from blocked_dates where blocked_date = ${date}::date
  `;
  if (blocked.length) {
    return { ok: false, status: 409, error: "Patricia n'est pas disponible ce jour-là." };
  }

  return { ok: true };
}

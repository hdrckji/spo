/**
 * Configuration partagée du module de réservation.
 *
 * Source de vérité unique : le navigateur ne décide plus ni des créneaux,
 * ni des tarifs. Il les reçoit de /api/availability et /api/reserve les
 * revalide côté serveur avant tout enregistrement.
 */

export const TIMEZONE = "Europe/Brussels";

export const PLACE = {
  name: "Centre Petite Fontaine",
  street: "Petite Place 7",
  postalCode: "7600",
  city: "Péruwelz",
  country: "Belgique",
};

export const CONTACT_EMAIL = "contact@instants-reflexo.be";

/**
 * URL publique du site, pour construire les liens d'annulation.
 * SITE_URL en production ; à défaut l'URL de déploiement fournie par Vercel.
 */
export function siteURL() {
  const explicit = process.env.SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "https://instants-reflexo.be";
}

/** Durée d'une séance, en minutes. */
export const SESSION_MINUTES = 60;

/** Nombre de vendredis proposés à la réservation. */
export const WEEKS_AHEAD = 8;

/**
 * Délai minimum entre la réservation et la séance.
 * Évite qu'un créneau soit pris une heure avant.
 */
export const MIN_NOTICE_HOURS = 24;

export const TYPES = {
  classique: {
    id: "classique",
    label: "Classique",
    price: 65,
    desc: "Réflexologie plantaire — 1h",
  },
  personnalisee: {
    id: "personnalisee",
    label: "Personnalisée",
    price: 85,
    desc: "Moxa & Psio — 10h30 ou 16h",
  },
};

export const SLOTS = [
  { id: "09:30", label: "9h30 – 10h30", perso: false },
  { id: "10:30", label: "10h30 – 11h30", perso: true },
  { id: "14:00", label: "14h00 – 15h00", perso: false },
  { id: "15:00", label: "15h00 – 16h00", perso: false },
  { id: "16:00", label: "16h00 – 17h00", perso: true },
];

export const SLOT_BY_ID = new Map(SLOTS.map((s) => [s.id, s]));

/* ============================================================
   Dates — tout est calculé en Europe/Brussels, jamais en UTC.

   Le bug corrigé ici : `new Date().toISOString().slice(0, 10)` renvoie
   la date UTC. À minuit heure belge (UTC+1 ou +2), l'UTC est encore la
   veille — un vendredi devenait le jeudi précédent dans les données
   envoyées, alors que l'affichage montrait bien le vendredi.
   ============================================================ */

const ISO_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Date du jour à Bruxelles, au format YYYY-MM-DD. */
export function todayISO() {
  return ISO_DATE.format(new Date());
}

/** Arithmétique sur date civile — en UTC pour n'avoir aucune dérive de fuseau. */
function civil(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toISO(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Les `count` prochains vendredis à partir d'aujourd'hui (exclus si on est
 * déjà vendredi : on propose alors le vendredi suivant).
 */
export function nextFridays(count = WEEKS_AHEAD, fromISO = todayISO()) {
  const cursor = civil(fromISO);
  const delta = ((5 - cursor.getUTCDay() + 7) % 7) || 7;
  cursor.setUTCDate(cursor.getUTCDate() + delta);

  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(toISO(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return out;
}

/**
 * Convertit une date + heure locale de Bruxelles en instant UTC.
 *
 * On formate un instant candidat dans le fuseau cible pour en déduire le
 * décalage réel (été/hiver), puis on l'inverse. Ambigu uniquement pendant
 * l'heure sautée/répétée du changement d'heure, à 2h du matin — hors de
 * la plage des séances (9h30–17h).
 */
export function brusselsToUTC(isoDate, time) {
  const [hh, mm] = time.split(":").map(Number);
  const naive = new Date(`${isoDate}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`);

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TIMEZONE,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(naive)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)])
  );

  // `hour` vaut 24 à minuit dans certaines implémentations d'Intl.
  const hour = parts.hour === 24 ? 0 : parts.hour;
  const asIfUTC = Date.UTC(parts.year, parts.month - 1, parts.day, hour, parts.minute, parts.second);

  return new Date(naive.getTime() - (asIfUTC - naive.getTime()));
}

/** Instant UTC du début et de la fin d'un créneau. */
export function slotInstants(isoDate, slotId) {
  const start = brusselsToUTC(isoDate, slotId);
  return { start, end: new Date(start.getTime() + SESSION_MINUTES * 60_000) };
}

const LONG_DATE = new Intl.DateTimeFormat("fr-BE", {
  timeZone: TIMEZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const SHORT_DATE = new Intl.DateTimeFormat("fr-BE", {
  timeZone: TIMEZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
});

/** « vendredi 14 août 2026 » — formaté à partir de la date civile, sans dérive. */
export function longLabel(isoDate) {
  return LONG_DATE.format(brusselsToUTC(isoDate, "12:00"));
}

/** « ven. 14 août » */
export function shortLabel(isoDate) {
  return SHORT_DATE.format(brusselsToUTC(isoDate, "12:00"));
}

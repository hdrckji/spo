/**
 * Génération de fichiers iCalendar (RFC 5545).
 *
 * Deux usages :
 *   - une pièce jointe .ics dans l'e-mail de confirmation du client ;
 *   - le flux d'abonnement /api/calendar, que Patricia ajoute à
 *     l'application de calendrier de son choix (Google, Apple, Outlook).
 *
 * Les instants sont écrits en UTC (suffixe Z) : pas de VTIMEZONE à
 * embarquer, et aucune ambiguïté de fuseau à la lecture.
 */

import { PLACE } from "./config.js";

const CRLF = "\r\n";

/** Échappement RFC 5545 : antislash, point-virgule, virgule, saut de ligne. */
function esc(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** 2026-08-14T14:00:00.000Z → 20260814T140000Z */
function stamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * Pliage des lignes à 75 octets, continuation préfixée d'une espace.
 * On compte en octets et non en caractères : « é » en pèse deux, et
 * couper au milieu produirait un fichier invalide.
 */
function fold(line) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;

  const out = [];
  let start = 0;
  let limit = 75;

  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // ne pas couper au milieu d'une séquence UTF-8
    while (end > start && end < bytes.length && (bytes[end] & 0b1100_0000) === 0b1000_0000) {
      end--;
    }
    out.push((out.length ? " " : "") + bytes.subarray(start, end).toString("utf8"));
    start = end;
    limit = 74; // l'espace de continuation compte dans les 75
  }
  return out.join(CRLF);
}

export const LOCATION = `${PLACE.name}, ${PLACE.street}, ${PLACE.postalCode} ${PLACE.city}, ${PLACE.country}`;

/**
 * @param {object}  options
 * @param {string}  options.calName     nom affiché du calendrier
 * @param {string} [options.method]     PUBLISH pour une pièce jointe, absent pour un flux
 * @param {Array}   options.events      { uid, start, end, summary, description, status, sequence }
 */
export function buildICS({ calName, method, events }) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Instants Reflexo//Reservation//FR",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${esc(calName)}`,
    "X-WR-TIMEZONE:Europe/Brussels",
  ];
  if (method) lines.push(`METHOD:${method}`);

  const now = stamp(new Date());

  for (const ev of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${esc(ev.uid)}`,
      `DTSTAMP:${now}`,
      `DTSTART:${stamp(ev.start)}`,
      `DTEND:${stamp(ev.end)}`,
      `SUMMARY:${esc(ev.summary)}`,
      `LOCATION:${esc(LOCATION)}`,
      `SEQUENCE:${ev.sequence ?? 0}`,
      `STATUS:${ev.status ?? "CONFIRMED"}`,
      "TRANSP:OPAQUE"
    );
    if (ev.description) lines.push(`DESCRIPTION:${esc(ev.description)}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.map(fold).join(CRLF) + CRLF;
}

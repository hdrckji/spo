/**
 * Secrets et jetons.
 *
 * Un seul secret à configurer : ADMIN_TOKEN.
 *   - il ouvre /admin.html (liste des rendez-vous, blocage de dates) ;
 *   - le jeton du flux ICS en est *dérivé* par HMAC, pour qu'on puisse
 *     partager l'URL du calendrier sans donner l'accès administrateur.
 *
 * Les jetons d'annulation, eux, sont tirés au hasard et stockés en base :
 * révocables un par un, et sans lien avec le secret du site.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function secret() {
  const value = process.env.ADMIN_TOKEN;
  if (!value || value.length < 24) {
    throw new Error(
      "ADMIN_TOKEN doit être défini et faire au moins 24 caractères. Voir README.md."
    );
  }
  return value;
}

/** Comparaison à temps constant, tolérante aux longueurs différentes. */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function isAdmin(req) {
  const header = req.headers?.authorization || "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!provided) return false;
  try {
    return safeEqual(provided, secret());
  } catch {
    return false;
  }
}

/** Jeton du flux ICS — dérivé d'ADMIN_TOKEN, ne permet pas de remonter à lui. */
export function calendarToken() {
  return createHmac("sha256", secret()).update("calendar-feed-v1").digest("base64url");
}

export function isCalendarToken(candidate) {
  if (!candidate) return false;
  try {
    return safeEqual(candidate, calendarToken());
  } catch {
    return false;
  }
}

/** Jeton d'annulation, aléatoire et propre à une réservation. */
export function newCancelToken() {
  return randomBytes(24).toString("base64url");
}

/**
 * Hachage de l'adresse IP pour la limitation de débit.
 *
 * L'IP n'est jamais conservée en clair. Le sel est ADMIN_TOKEN, ce qui rend
 * le hachage non rejouable hors du site.
 *
 * Si ADMIN_TOKEN manque ou est trop court, on hache quand même — avec un sel
 * constant, faute de mieux. La limitation de débit continue de fonctionner
 * (le hachage reste déterministe) et surtout, aucune adresse IP n'atterrit
 * en clair dans la base à cause d'une variable d'environnement mal réglée.
 */
const FALLBACK_SALT = "instants-reflexo:rate-limit:no-admin-token";

export function hashIP(req) {
  const forwarded = req.headers?.["x-forwarded-for"] || "";
  const ip = String(forwarded).split(",")[0].trim() || req.socket?.remoteAddress || "unknown";

  let salt;
  try {
    salt = secret();
  } catch {
    console.error(
      "[auth] ADMIN_TOKEN absent ou trop court — hachage des IP avec un sel constant. Voir README.md."
    );
    salt = FALLBACK_SALT;
  }
  return createHmac("sha256", salt).update(ip).digest("hex").slice(0, 32);
}

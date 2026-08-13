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

/**
 * Longueur minimale d'ADMIN_TOKEN.
 *
 * Volontairement basse, pour qu'un mot de passe retenable suffise. Ce n'est
 * pas la longueur du secret qui protège l'agenda, c'est la limitation des
 * tentatives (voir throttle.js) : cinq échecs par quart d'heure et par
 * adresse, puis refus. À ce rythme, deviner huit caractères demanderait un
 * temps sans commune mesure avec la durée d'une vie.
 *
 * Ce que la limitation ne couvre pas, c'est une *fuite* du jeton — quelqu'un
 * qui le lit par-dessus une épaule. Contre ça, la longueur ne peut rien non
 * plus : seul le fait de le changer protège.
 */
export const MIN_TOKEN_LENGTH = 8;

/**
 * Décrit ce qui cloche avec ADMIN_TOKEN, ou null si tout va bien.
 *
 * Sépare deux situations qu'on confondrait sinon : « le jeton du serveur est
 * inutilisable » et « tu as saisi le mauvais jeton ». Sans cette distinction,
 * un ADMIN_TOKEN trop court se manifeste par un simple « jeton refusé », et
 * on cherche l'erreur du mauvais côté.
 */
export function adminTokenProblem() {
  const value = process.env.ADMIN_TOKEN;
  if (!value) {
    return "ADMIN_TOKEN n'est pas défini dans les variables d'environnement.";
  }
  if (value.length < MIN_TOKEN_LENGTH) {
    return `ADMIN_TOKEN ne fait que ${value.length} caractères ; il en faut au moins ${MIN_TOKEN_LENGTH}.`;
  }
  return null;
}

function secret() {
  const problem = adminTokenProblem();
  if (problem) throw new Error(problem + " Voir README.md.");
  return process.env.ADMIN_TOKEN;
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

/**
 * Envoi de SMS transactionnels via Brevo.
 *
 * Configuration :
 *   BREVO_API_KEY     clé API Brevo (obligatoire, sinon aucun SMS n'est envoyé)
 *   BREVO_SMS_SENDER  nom d'expéditeur affiché, 11 caractères maximum
 *   SMS_COUNTRY_CODE  indicatif par défaut pour les numéros nationaux (32 = Belgique)
 *
 * Comme partout ailleurs dans ce projet : pas d'échec silencieux. Sans clé,
 * la fonction le dit et renvoie false ; en cas de refus de Brevo, la réponse
 * complète part dans les journaux Vercel.
 */

const ENDPOINT = "https://api.brevo.com/v3/transactionalSMS/sms";

/** Brevo limite le nom d'expéditeur à 11 caractères. */
const MAX_SENDER = 11;

/** Un SMS en alphabet GSM-7 tient en 160 caractères ; en Unicode, 70 seulement. */
export const GSM_LIMIT = 160;

export function sender() {
  return (process.env.BREVO_SMS_SENDER || "InstantsRfx").slice(0, MAX_SENDER);
}

/**
 * Met un numéro au format attendu par Brevo : indicatif pays puis numéro,
 * sans « + » ni séparateur. « 0470 11 22 33 » devient « 32470112233 ».
 *
 * @returns {string|null} null si le numéro est inutilisable.
 */
export function normalizePhone(raw, countryCode = process.env.SMS_COUNTRY_CODE || "32") {
  if (!raw) return null;

  let digits = String(raw).trim();
  const hadPlus = digits.startsWith("+");
  digits = digits.replace(/[^\d]/g, "");
  if (!digits) return null;

  if (hadPlus) {
    // déjà international
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (digits.startsWith("0")) {
    // numéro national : le 0 de service laisse place à l'indicatif
    digits = countryCode + digits.slice(1);
  } else if (!digits.startsWith(countryCode)) {
    // numéro sans préfixe ni indicatif, du type « 470112233 »
    digits = countryCode + digits;
  }

  // Un numéro international plausible fait de 8 à 15 chiffres (norme E.164).
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

/**
 * Ramène le texte à l'alphabet GSM-7 en retirant les accents.
 *
 * Ce n'est pas de la coquetterie : un seul caractère hors GSM-7 fait basculer
 * le message entier en Unicode, où un SMS ne compte plus que 70 caractères.
 * Un rappel accentué partirait donc en trois segments facturés au lieu d'un.
 */
export function toGSM7(text) {
  return String(text)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[«»]/g, '"')
    .replace(/…/g, "...")
    .replace(/ /g, " ");
}

/** Nombre de segments facturés par Brevo pour ce texte. */
export function segments(text) {
  return Math.max(1, Math.ceil(text.length / GSM_LIMIT));
}

export function isConfigured() {
  return Boolean(process.env.BREVO_API_KEY);
}

/**
 * Envoie un SMS. Ne lève jamais.
 *
 * Renvoie un compte rendu plutôt qu'un simple booléen : en cas de refus, le
 * message d'erreur de Brevo doit pouvoir remonter jusqu'à l'écran, sans quoi
 * il faut aller le chercher dans les journaux Vercel.
 *
 * @returns {Promise<{ok: boolean, error?: string, status?: number, recipient?: string, segments?: number}>}
 */
export async function sendSMS(phone, message) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.error("[sms] BREVO_API_KEY absente — aucun SMS envoyé. Voir README.md.");
    return { ok: false, error: "BREVO_API_KEY n'est pas configurée dans Vercel." };
  }

  const recipient = normalizePhone(phone);
  if (!recipient) {
    console.error("[sms] numéro inutilisable, SMS non envoyé");
    return { ok: false, error: `Numéro inutilisable : « ${phone} ».` };
  }

  const content = toGSM7(message);
  const count = segments(content);
  if (count > 1) {
    console.warn(`[sms] message de ${content.length} caractères : ${count} segments facturés`);
  }

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: sender(),
        recipient,
        content,
        type: "transactional",
      }),
    });

    if (!res.ok) {
      // Si Brevo refuse l'expéditeur, le format du numéro ou le crédit,
      // son message le dit précisément — on le fait remonter tel quel.
      const detail = await res.text();
      console.error("[sms] échec Brevo :", res.status, detail);
      return { ok: false, status: res.status, error: brevoMessage(res.status, detail), recipient };
    }
    return { ok: true, recipient, segments: count };
  } catch (err) {
    console.error("[sms] erreur réseau :", err);
    return { ok: false, error: "Brevo est injoignable : " + err.message };
  }
}

/** Extrait le message lisible d'une réponse d'erreur Brevo. */
function brevoMessage(status, body) {
  let detail = body;
  try {
    const parsed = JSON.parse(body);
    detail = parsed.message || parsed.error || body;
  } catch {
    // corps non JSON : on garde le texte brut
  }
  const hint =
    status === 401
      ? " — la clé API est refusée."
      : status === 402
        ? " — crédits SMS épuisés sur le compte Brevo."
        : status === 400
          ? " — Brevo refuse un champ : souvent le nom d'expéditeur ou le numéro."
          : "";
  return `Brevo a répondu ${status} : ${String(detail).slice(0, 300)}${hint}`;
}

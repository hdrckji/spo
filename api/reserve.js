/**
 * POST /api/reserve — enregistrement d'une réservation.
 *
 * Garanties :
 *   - le créneau est verrouillé par un index unique partiel en base, donc
 *     deux demandes simultanées ne peuvent pas prendre le même créneau ;
 *   - le tarif et le libellé du créneau sont *recalculés* côté serveur : ce
 *     que le navigateur envoie n'est jamais repris tel quel ;
 *   - si l'envoi des e-mails échoue, la réservation reste valide et la
 *     réponse le dit explicitement — pas de succès de façade.
 */

import { SLOT_BY_ID, TYPES, longLabel } from "./_lib/config.js";
import { isConfigured, isSlotTaken, sql } from "./_lib/db.js";
import { hashIP, newCancelToken } from "./_lib/auth.js";
import { isValidEmail, sendBookingEmails } from "./_lib/mail.js";
import { validateRequest } from "./_lib/availability.js";
import { ensureSchema } from "./_lib/migrate.js";

/** Tentatives autorisées par heure et par adresse IP. */
const RATE_LIMIT = 5;

const MAX = { name: 120, email: 254, phone: 40, message: 2000 };

function clean(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

const LETTER = /\p{L}/u;

/**
 * Le nom *et* le prénom sont exigés.
 *
 * Le formulaire n'a qu'un seul champ — plus simple à remplir qu'une paire, et
 * `autocomplete="name"` le préremplit. C'est donc ici qu'il faut vérifier
 * qu'il porte bien les deux : le contrôle de non-vide laissait passer
 * « Marie », et Patricia recevait un rendez-vous qu'elle ne pouvait rattacher
 * à personne.
 *
 * Volontairement tolérant sur la forme : deux parties séparées d'un blanc,
 * chacune contenant au moins une lettre. « Li Na », « Marie J. » et
 * « Anne-Sophie Van der Berg » passent ; « Marie » et « M. » non.
 */
function hasFullName(value) {
  return String(value).split(/\s+/).filter((part) => LETTER.test(part)).length >= 2;
}

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Méthode non autorisée" });
  }

  const body = readBody(req);

  // Pot de miel : un humain ne remplit jamais ce champ. On répond comme si
  // tout allait bien pour ne rien apprendre au robot.
  if (body.website) {
    return res.status(200).json({ ok: true });
  }

  if (!isConfigured()) {
    console.error("[reserve] DATABASE_URL absente — réservation impossible. Voir README.md.");
    return res.status(503).json({
      ok: false,
      error:
        "Le module de réservation est momentanément indisponible. Écrivez-nous à contact@instants-reflexo.be.",
    });
  }

  const date = clean(body.date, 10);
  const slot = clean(body.slot, 5);
  const type = clean(body.type, 20);
  // Les blancs multiples sont ramenés à un seul : « Marie   Dupont » ne doit
  // pas ressortir tel quel dans l'e-mail ni dans l'agenda.
  const name = clean(body.name, MAX.name).replace(/\s+/g, " ");
  const email = clean(body.email, MAX.email).toLowerCase();
  const phone = clean(body.phone, MAX.phone);
  const message = clean(body.message, MAX.message);

  if (!name || !email) {
    return res.status(400).json({ ok: false, error: "Nom et adresse e-mail sont requis." });
  }
  if (!hasFullName(name)) {
    return res.status(400).json({
      ok: false,
      error: "Merci d'indiquer votre nom et votre prénom.",
    });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ ok: false, error: "L'adresse e-mail semble invalide." });
  }

  try {
    // Porte le schéma à niveau si le déploiement en a changé la forme.
    // Sans effet et sans requête une fois la fonction chaude.
    await ensureSchema();

    const check = await validateRequest({ date, slot, type });
    if (!check.ok) {
      return res.status(check.status).json({ ok: false, error: check.error });
    }

    /* ---- Limitation de débit ---- */
    const ipHash = hashIP(req);
    const [{ count }] = await sql`
      select count(*)::int as count
        from reserve_attempts
       where ip_hash = ${ipHash}
         and created_at > now() - interval '1 hour'
    `;
    if (count >= RATE_LIMIT) {
      return res.status(429).json({
        ok: false,
        error: "Trop de demandes envoyées. Réessayez dans une heure ou écrivez-nous directement.",
      });
    }
    await sql`insert into reserve_attempts (ip_hash) values (${ipHash})`;

    /* ---- Enregistrement ---- */
    const typeDef = TYPES[type];
    const slotDef = SLOT_BY_ID.get(slot);
    const cancelToken = newCancelToken();

    let inserted;
    try {
      [inserted] = await sql`
        insert into bookings
          (booking_date, slot, session_type, price_cents, name, email, phone, message, cancel_token, ip_hash)
        values
          (${date}::date, ${slot}, ${type}, ${typeDef.price * 100}, ${name}, ${email},
           ${phone || null}, ${message || null}, ${cancelToken}, ${ipHash})
        returning id
      `;
    } catch (err) {
      if (isSlotTaken(err)) {
        return res.status(409).json({
          ok: false,
          code: "slot_taken",
          error: "Ce créneau vient d'être réservé. Merci d'en choisir un autre.",
        });
      }
      throw err;
    }

    /* ---- Notifications ---- */
    const booking = {
      id: inserted.id,
      booking_date: date,
      slot,
      slot_label: slotDef.label,
      session_type: type,
      name,
      email,
      phone,
      message,
      cancel_token: cancelToken,
    };

    const mail = await sendBookingEmails(booking);
    if (!mail.practitioner || !mail.client) {
      console.error("[reserve] réservation", inserted.id, "enregistrée mais e-mails partiels :", mail);
    }

    return res.status(201).json({
      ok: true,
      emailed: mail.client,
      booking: {
        date,
        dateLabel: longLabel(date),
        slot: slotDef.label,
        type: typeDef.label,
        price: typeDef.price,
        name,
      },
    });
  } catch (err) {
    console.error("[reserve] erreur :", err);
    return res.status(500).json({
      ok: false,
      error:
        "Un souci technique empêche l'enregistrement. Écrivez-nous à contact@instants-reflexo.be.",
    });
  }
}

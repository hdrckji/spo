/**
 * Réception des demandes de réservation — Vercel Serverless Function.
 *
 * Envoi d'e-mails via l'API Resend (https://resend.com) :
 *   - RESEND_API_KEY      : clé API Resend (variable d'environnement Vercel)
 *   - RESERVATION_EMAIL   : destinataire des notifications
 *                           (défaut : contact@instants-reflexo.be)
 *   - RESEND_FROM         : expéditeur vérifié chez Resend
 *                           (défaut : onboarding@resend.dev, utilisable sans
 *                           vérification de domaine pour les tests)
 *
 * Sans RESEND_API_KEY, la demande est simplement journalisée (mode démo)
 * et la réponse reste positive pour ne pas bloquer le parcours utilisateur.
 */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Méthode non autorisée" });
  }

  const {
    type = "",
    price = "",
    date = "",
    dateLabel = "",
    slot = "",
    name = "",
    email = "",
    phone = "",
    message = "",
    website = "",
  } = req.body || {};

  // Honeypot anti-spam : un humain ne remplit jamais ce champ.
  if (website) {
    return res.status(200).json({ ok: true });
  }

  if (!name || !email || !date || !slot || !type) {
    return res.status(400).json({ ok: false, error: "Champs manquants" });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.RESERVATION_EMAIL || "contact@instants-reflexo.be";
  const from = process.env.RESEND_FROM || "Instants Réflexo <onboarding@resend.dev>";

  const recap = [
    `Séance     : ${type} (${price} €)`,
    `Date       : ${dateLabel} (${date})`,
    `Créneau    : ${slot}`,
    ``,
    `Client·e   : ${name}`,
    `E-mail     : ${email}`,
    `Téléphone  : ${phone || "—"}`,
    ``,
    `Message    :`,
    message || "—",
  ].join("\n");

  if (!apiKey) {
    console.log("[reserve] mode démo — demande reçue :\n" + recap);
    return res.status(200).json({ ok: true, demo: true });
  }

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: email,
        subject: `Réservation — ${type} · ${dateLabel} · ${slot} — ${name}`,
        text: recap,
      }),
    });

    if (!r.ok) {
      const detail = await r.text();
      console.error("[reserve] échec Resend :", r.status, detail);
      return res.status(502).json({ ok: false, error: "Échec de l'envoi" });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[reserve] erreur :", err);
    return res.status(500).json({ ok: false, error: "Erreur serveur" });
  }
}

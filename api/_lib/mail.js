/**
 * Envoi des e-mails de réservation via Resend.
 *
 * Deux messages par réservation :
 *   1. la notification à Patricia (avec possibilité de répondre au client) ;
 *   2. la confirmation au client, avec le rendez-vous en pièce jointe .ics.
 *
 * Aucun « mode démo » silencieux : si la configuration manque ou si l'envoi
 * échoue, la fonction le signale et l'appelant en informe l'utilisateur.
 * La réservation reste enregistrée en base — c'est elle qui fait foi.
 */

import { CONTACT_EMAIL, PLACE, TYPES, longLabel, siteURL, slotInstants } from "./config.js";
import { buildICS, LOCATION } from "./ics.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value) {
  return EMAIL_RE.test(String(value || "")) && String(value).length <= 254;
}

function recipient() {
  return process.env.RESERVATION_EMAIL || CONTACT_EMAIL;
}

function sender() {
  return process.env.RESEND_FROM || `Instants Réflexo <${CONTACT_EMAIL}>`;
}

async function send(payload) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error(
      "[mail] RESEND_API_KEY absente — aucun e-mail envoyé. Configurez-la dans Vercel (voir README.md)."
    );
    return false;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.error("[mail] échec Resend :", res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("[mail] erreur réseau :", err);
    return false;
  }
}

function recapText(b) {
  const type = TYPES[b.session_type];
  return [
    `Séance     : ${type.label} (${type.price} €)`,
    `Date       : ${longLabel(b.booking_date)}`,
    `Créneau    : ${b.slot_label}`,
    `Lieu       : ${LOCATION}`,
    ``,
    `Client·e   : ${b.name}`,
    `E-mail     : ${b.email}`,
    `Téléphone  : ${b.phone || "—"}`,
    ``,
    `Message    :`,
    b.message || "—",
  ].join("\n");
}

function escapeHTML(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

function clientHTML(b, cancelURL) {
  const type = TYPES[b.session_type];
  return `<!doctype html>
<html lang="fr"><body style="margin:0;padding:0;background:#f6f1e7;font-family:'Helvetica Neue',Arial,sans-serif;color:#2b3327;">
  <div style="max-width:540px;margin:0 auto;padding:32px 24px;">
    <p style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#8a9b82;margin:0 0 24px;">Instants Réflexo</p>
    <h1 style="font-size:24px;font-weight:500;margin:0 0 16px;color:#2e4034;">Votre rendez-vous est confirmé</h1>
    <p style="font-size:15px;line-height:1.6;margin:0 0 24px;">
      Bonjour ${escapeHTML(b.name)},<br>
      votre séance est réservée. Vous trouverez le rendez-vous en pièce jointe, à ajouter à votre agenda.
    </p>
    <table style="width:100%;border-collapse:collapse;background:#fdfbf6;border-radius:12px;">
      <tr><td style="padding:14px 18px;border-bottom:1px solid #e7dcc6;font-size:14px;color:#8a9b82;">Séance</td>
          <td style="padding:14px 18px;border-bottom:1px solid #e7dcc6;font-size:14px;text-align:right;">${escapeHTML(type.label)} — ${type.price} €</td></tr>
      <tr><td style="padding:14px 18px;border-bottom:1px solid #e7dcc6;font-size:14px;color:#8a9b82;">Date</td>
          <td style="padding:14px 18px;border-bottom:1px solid #e7dcc6;font-size:14px;text-align:right;">${escapeHTML(longLabel(b.booking_date))}</td></tr>
      <tr><td style="padding:14px 18px;border-bottom:1px solid #e7dcc6;font-size:14px;color:#8a9b82;">Créneau</td>
          <td style="padding:14px 18px;border-bottom:1px solid #e7dcc6;font-size:14px;text-align:right;">${escapeHTML(b.slot_label)}</td></tr>
      <tr><td style="padding:14px 18px;font-size:14px;color:#8a9b82;">Lieu</td>
          <td style="padding:14px 18px;font-size:14px;text-align:right;">${escapeHTML(PLACE.name)}<br>${escapeHTML(PLACE.street)}, ${escapeHTML(PLACE.postalCode)} ${escapeHTML(PLACE.city)}</td></tr>
    </table>
    <p style="font-size:14px;line-height:1.6;margin:24px 0 0;color:#5a6553;">
      Le paiement se fait sur place. Un empêchement&nbsp;?
      <a href="${escapeHTML(cancelURL)}" style="color:#c17a54;">Annulez votre rendez-vous</a> —
      cela libère le créneau pour quelqu'un d'autre.
    </p>
    <div style="margin:20px 0 0;padding:14px 18px;background:#fbf3ec;border-left:3px solid #c17a54;border-radius:12px;">
      <p style="margin:0 0 8px;font-size:14px;font-weight:600;color:#2e4034;">Merci de reporter la séance si&nbsp;:</p>
      <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.7;color:#5a6553;">
        <li>vous avez une prise de sang dans les 15 jours qui viennent&nbsp;;</li>
        <li>vous êtes enceinte de moins de trois mois&nbsp;;</li>
        <li>vous avez été opéré·e il y a moins d'un mois, ou une opération est prévue.</li>
      </ul>
      <p style="margin:8px 0 0;font-size:13px;color:#5a6553;">
        Dans ces cas, <a href="${escapeHTML(cancelURL)}" style="color:#c17a54;">annulez</a> et
        écrivez-nous&nbsp;: nous trouverons une autre date.
      </p>
    </div>
    <p style="font-size:13px;line-height:1.6;margin:28px 0 0;color:#8a9b82;border-top:1px solid #e7dcc6;padding-top:20px;">
      Instants Réflexo — Patricia Valck · ${escapeHTML(CONTACT_EMAIL)}<br>
      La réflexologie plantaire ne se substitue pas à un avis ou un traitement médical.
    </p>
  </div>
</body></html>`;
}

/**
 * Envoie les deux e-mails. Ne lève jamais : renvoie l'état de chaque envoi
 * pour que l'appelant décide quoi montrer à l'utilisateur.
 */
export async function sendBookingEmails(booking) {
  const type = TYPES[booking.session_type];
  const cancelURL = `${siteURL()}/api/cancel?token=${encodeURIComponent(booking.cancel_token)}`;
  const { start, end } = slotInstants(booking.booking_date, booking.slot);

  const ics = buildICS({
    calName: "Instants Réflexo",
    method: "PUBLISH",
    events: [
      {
        uid: `${booking.id}@instants-reflexo.be`,
        start,
        end,
        summary: `Réflexologie plantaire — séance ${type.label.toLowerCase()}`,
        description: `Séance de réflexologie plantaire avec Patricia Valck.\nPaiement sur place (${type.price} €).\nAnnulation : ${cancelURL}`,
      },
    ],
  });

  const dateLabel = longLabel(booking.booking_date);

  const toPractitioner = send({
    from: sender(),
    to: [recipient()],
    reply_to: isValidEmail(booking.email) ? booking.email : undefined,
    subject: `Réservation — ${type.label} · ${dateLabel} · ${booking.slot_label} — ${booking.name}`,
    text: recapText(booking),
  });

  const toClient = send({
    from: sender(),
    to: [booking.email],
    reply_to: recipient(),
    subject: `Votre rendez-vous du ${dateLabel} — Instants Réflexo`,
    html: clientHTML(booking, cancelURL),
    text: [
      `Bonjour ${booking.name},`,
      ``,
      `Votre séance de réflexologie plantaire est confirmée :`,
      ``,
      recapText(booking),
      ``,
      `Paiement sur place. Pour annuler : ${cancelURL}`,
      ``,
      `Merci de reporter la séance si :`,
      `  · vous avez une prise de sang dans les 15 jours qui viennent ;`,
      `  · vous êtes enceinte de moins de trois mois ;`,
      `  · vous avez été opéré·e il y a moins d'un mois, ou une opération est prévue.`,
      ``,
      `— Instants Réflexo, Patricia Valck`,
    ].join("\n"),
    attachments: [
      {
        filename: "rendez-vous.ics",
        content: Buffer.from(ics, "utf8").toString("base64"),
        content_type: "text/calendar; method=PUBLISH; charset=utf-8",
      },
    ],
  });

  const [practitioner, client] = await Promise.all([toPractitioner, toClient]);
  return { practitioner, client };
}

/** Prévenir Patricia qu'un créneau vient de se libérer. */
export async function sendCancellationEmail(booking) {
  const type = TYPES[booking.session_type];
  return send({
    from: sender(),
    to: [recipient()],
    subject: `Annulation — ${longLabel(booking.booking_date)} · ${booking.slot_label} — ${booking.name}`,
    text: [
      `${booking.name} a annulé son rendez-vous.`,
      ``,
      `Séance   : ${type.label}`,
      `Date     : ${longLabel(booking.booking_date)}`,
      `Créneau  : ${booking.slot_label}`,
      `Contact  : ${booking.email}${booking.phone ? " · " + booking.phone : ""}`,
      ``,
      `Le créneau est de nouveau proposé à la réservation.`,
    ].join("\n"),
  });
}

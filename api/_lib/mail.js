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

import { CONTACT_EMAIL, PLACE, TYPES, dateParts, longLabel, siteURL, slotInstants } from "./config.js";
import { buildICS, LOCATION } from "./ics.js";
import {
  COLORS,
  button,
  dateBanner,
  detailRow,
  detailsTable,
  escapeHTML,
  mapsURL,
  precautionsBox,
  shell,
} from "./email-template.js";

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


function cancelURLFor(booking) {
  return `${siteURL()}/api/cancel?token=${encodeURIComponent(booking.cancel_token)}`;
}

/**
 * Pièce jointe calendrier d'un rendez-vous.
 *
 * L'UID ne change jamais et SEQUENCE suit `revision` : après un déplacement,
 * les applications de calendrier mettent donc à jour l'événement existant au
 * lieu d'en ajouter un second à côté de l'ancien.
 */
function bookingICS(booking) {
  const type = TYPES[booking.session_type];
  const cancelURL = cancelURLFor(booking);
  const { start, end } = slotInstants(booking.booking_date, booking.slot);

  return buildICS({
    calName: "Instants Réflexo",
    method: "PUBLISH",
    events: [
      {
        uid: `${booking.id}@instants-reflexo.be`,
        start,
        end,
        sequence: booking.revision ?? 0,
        summary: `Réflexologie plantaire — séance ${type.label.toLowerCase()}`,
        description: `Séance de réflexologie plantaire avec Patricia Valck.\nPaiement sur place (${type.price} €).\nAnnulation : ${cancelURL}`,
      },
    ],
  });
}

function icsAttachment(booking) {
  return {
    filename: "rendez-vous.ics",
    content: Buffer.from(bookingICS(booking), "utf8").toString("base64"),
    content_type: "text/calendar; method=PUBLISH; charset=utf-8",
  };
}

/** Adresse en HTML, cliquable vers la carte. */
function addressBlock() {
  return `<a href="${mapsURL()}" style="color:${COLORS.ink};text-decoration:none;">
    ${escapeHTML(PLACE.name)}<br>
    <span style="color:${COLORS.sage};">${escapeHTML(PLACE.street)}, ${escapeHTML(PLACE.postalCode)} ${escapeHTML(PLACE.city)}</span>
    <span style="color:${COLORS.terra};font-size:13px;"> &nbsp;Voir le plan &rsaquo;</span></a>`;
}

/** Corps de l'e-mail de confirmation. */
function confirmationHTML(booking, cancelURL) {
  const type = TYPES[booking.session_type];
  const { weekday, dayMonth } = dateParts(booking.booking_date);

  return shell({
    preheader: `${weekday} ${dayMonth} à ${booking.slot_label} — ${PLACE.name}, ${PLACE.city}`,
    heading: "Votre rendez-vous est confirmé",
    intro: `Bonjour ${escapeHTML(booking.name)}, votre séance est réservée.
            Le rendez-vous est en pièce jointe, à ajouter à votre agenda d'un clic.`,
    body: `
      ${dateBanner({ weekday, dayMonth, time: booking.slot_label })}

      <div style="height:26px;line-height:26px;">&nbsp;</div>

      ${detailsTable([
        detailRow("Séance", escapeHTML(type.label)),
        detailRow("Tarif", `<strong style="font-size:16px;">${type.price} €</strong>
          <span style="color:${COLORS.sage};font-size:13px;"> à régler sur place</span>`),
        detailRow("Lieu", addressBlock(), { last: true }),
      ])}

      <div style="height:26px;line-height:26px;">&nbsp;</div>
      ${precautionsBox()}
      <div style="height:24px;line-height:24px;">&nbsp;</div>

      ${button(cancelURL, "Annuler mon rendez-vous", { subtle: true })}

      <div style="padding-top:14px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;
                  font-size:12.5px;line-height:1.6;color:${COLORS.sage};text-align:center;">
        Un empêchement&nbsp;? Annulez librement, cela libère le créneau pour quelqu'un d'autre.
      </div>`,
  });
}

/**
 * Envoie les deux e-mails. Ne lève jamais : renvoie l'état de chaque envoi
 * pour que l'appelant décide quoi montrer à l'utilisateur.
 */
export async function sendBookingEmails(booking) {
  const type = TYPES[booking.session_type];
  const cancelURL = cancelURLFor(booking);
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
    html: confirmationHTML(booking, cancelURL),
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
    attachments: [icsAttachment(booking)],
  });

  const [practitioner, client] = await Promise.all([toPractitioner, toClient]);
  return { practitioner, client };
}

/** Corps de l'e-mail de déplacement. */
function moveHTML(booking, previous, cancelURL) {
  const type = TYPES[booking.session_type];
  const { weekday, dayMonth } = dateParts(booking.booking_date);
  const old = dateParts(previous.booking_date);

  return shell({
    preheader: `Nouvelle date : ${weekday} ${dayMonth} à ${booking.slot_label}`,
    heading: "Votre rendez-vous a été déplacé",
    intro: `Bonjour ${escapeHTML(booking.name)}, Patricia a dû déplacer votre séance.
            La pièce jointe met à jour votre agenda&nbsp;: l'ancienne date en disparaît d'elle-même.`,
    body: `
      <div style="text-align:center;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;
                  font-size:14px;color:${COLORS.sage};text-decoration:line-through;padding-bottom:12px;">
        ${escapeHTML(old.weekday)} ${escapeHTML(old.dayMonth)} — ${escapeHTML(previous.slot_label)}
      </div>

      ${dateBanner({ weekday, dayMonth, time: booking.slot_label })}

      <div style="height:26px;line-height:26px;">&nbsp;</div>

      ${detailsTable([
        detailRow("Séance", escapeHTML(type.label)),
        detailRow("Tarif", `<strong style="font-size:16px;">${type.price} €</strong>
          <span style="color:${COLORS.sage};font-size:13px;"> à régler sur place</span>`),
        detailRow("Lieu", addressBlock(), { last: true }),
      ])}

      <div style="height:26px;line-height:26px;">&nbsp;</div>

      ${button(cancelURL, "Cette date ne me convient pas", { subtle: true })}

      <div style="padding-top:14px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;
                  font-size:12.5px;line-height:1.6;color:${COLORS.sage};text-align:center;">
        Vous pouvez aussi simplement répondre à cet e-mail.
      </div>`,
  });
}

/**
 * Informe le client que Patricia a déplacé son rendez-vous.
 *
 * `booking` porte déjà la nouvelle date et la nouvelle révision ; `previous`
 * ne sert qu'à rappeler d'où l'on vient dans le message.
 */
export async function sendMoveEmail(booking, previous) {
  const type = TYPES[booking.session_type];
  const cancelURL = cancelURLFor(booking);
  const newLabel = longLabel(booking.booking_date);
  const oldLabel = `${longLabel(previous.booking_date)} (${previous.slot_label})`;

  return send({
    from: sender(),
    to: [booking.email],
    reply_to: recipient(),
    subject: `Votre rendez-vous est déplacé au ${newLabel} — Instants Réflexo`,
    html: moveHTML(booking, previous, cancelURL),
    text: [
      `Bonjour ${booking.name},`,
      ``,
      `Patricia a dû déplacer votre séance de réflexologie plantaire.`,
      ``,
      `Ancienne date : ${oldLabel}`,
      `Nouvelle date : ${newLabel} (${booking.slot_label})`,
      `Séance        : ${type.label} (${type.price} €)`,
      `Lieu          : ${LOCATION}`,
      ``,
      `La pièce jointe met à jour le rendez-vous dans votre agenda.`,
      ``,
      `Cette date ne vous convient pas ? Répondez à cet e-mail,`,
      `ou annulez ici : ${cancelURL}`,
      ``,
      `— Instants Réflexo, Patricia Valck`,
    ].join("\n"),
    attachments: [icsAttachment(booking)],
  });
}

/**
 * Rappel de la veille, par e-mail.
 *
 * Utilisé quand aucun numéro de téléphone n'a été laissé — sans quoi ces
 * rendez-vous seraient les seuls à ne recevoir aucun rappel.
 */
export async function sendReminderEmail(booking) {
  const type = TYPES[booking.session_type];
  const cancelURL = cancelURLFor(booking);
  const { weekday, dayMonth } = dateParts(booking.booking_date);

  return send({
    from: sender(),
    to: [booking.email],
    reply_to: recipient(),
    subject: `Rappel — votre séance demain à ${booking.slot_label}`,
    html: shell({
      preheader: `Demain ${weekday} ${dayMonth} à ${booking.slot_label}, ${PLACE.name}`,
      heading: "C'est demain",
      intro: `Bonjour ${escapeHTML(booking.name)}, un petit mot pour vous rappeler
              votre séance de réflexologie plantaire.`,
      body: `
        ${dateBanner({ weekday: `demain, ${weekday}`, dayMonth, time: booking.slot_label })}

        <div style="height:26px;line-height:26px;">&nbsp;</div>

        ${detailsTable([
          detailRow("Séance", escapeHTML(type.label)),
          detailRow("À prévoir", `<strong>${type.price} €</strong>
            <span style="color:${COLORS.sage};font-size:13px;"> à régler sur place</span>`),
          detailRow("Lieu", addressBlock(), { last: true }),
        ])}

        <div style="height:26px;line-height:26px;">&nbsp;</div>
        ${precautionsBox()}
        <div style="height:24px;line-height:24px;">&nbsp;</div>

        ${button(cancelURL, "Je ne pourrai pas venir", { subtle: true })}

        <div style="padding-top:14px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;
                    font-size:12.5px;line-height:1.6;color:${COLORS.sage};text-align:center;">
          Prévenir permet à quelqu'un d'autre de prendre le créneau. À demain&nbsp;!
        </div>`,
    }),
    text: [
      `Bonjour ${booking.name},`,
      ``,
      `Petit rappel : votre séance de réflexologie plantaire a lieu demain,`,
      `${weekday} ${dayMonth}, à ${booking.slot_label}.`,
      ``,
      `Séance : ${type.label} (${type.price} € à régler sur place)`,
      `Lieu   : ${LOCATION}`,
      ``,
      `Un empêchement ? Annulez ici : ${cancelURL}`,
      ``,
      `À demain,`,
      `Patricia — Instants Réflexo`,
    ].join("\n"),
  });
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

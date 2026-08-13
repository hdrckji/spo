/**
 * Rappel envoyé la veille du rendez-vous.
 *
 * Par SMS lorsqu'un numéro a été laissé, par e-mail sinon. Le téléphone étant
 * facultatif à la réservation, s'en tenir au SMS priverait de rappel une part
 * des clientes — et ce sont précisément celles qu'on ne pourrait pas joindre
 * autrement.
 */

import { PLACE, dateParts } from "./config.js";
import { sendReminderEmail } from "./mail.js";
import { GSM_LIMIT, normalizePhone, segments, sendSMS, toGSM7 } from "./sms.js";

/**
 * Texte du SMS.
 *
 * Rédigé sans accent et tenu sous 160 caractères à dessein : au-delà, ou avec
 * un seul caractère hors alphabet GSM-7, Brevo facture plusieurs segments.
 * `toGSM7` retire de toute façon les accents, mais autant écrire le message
 * tel qu'il partira.
 */
export function reminderSMS(booking) {
  const { weekday, dayMonth } = dateParts(booking.booking_date);
  const start = booking.slot_label.split("–")[0].trim();
  return toGSM7(
    `Rappel : votre seance de reflexologie a lieu demain ${weekday} ${dayMonth.replace(/ \d{4}$/, "")} a ${start}. ` +
      `${PLACE.name}, ${PLACE.street}, ${PLACE.city}. A demain ! Patricia`
  );
}

/**
 * Envoie le rappel par le canal disponible.
 * Ne lève jamais.
 *
 * @returns {Promise<{sent: boolean, channel: "sms"|"email"|null}>}
 */
export async function sendReminder(booking) {
  if (normalizePhone(booking.phone)) {
    const text = reminderSMS(booking);
    if (segments(text) > 1) {
      console.warn(`[reminder] SMS de ${text.length} caractères (> ${GSM_LIMIT}) : plusieurs segments`);
    }
    const result = await sendSMS(booking.phone, text);
    if (result.ok) {
      return { sent: true, channel: "sms" };
    }
    // L'envoi SMS a échoué : plutôt que de laisser la cliente sans rappel,
    // on bascule sur l'e-mail, dont on a forcément l'adresse.
    console.warn("[reminder] SMS refusé, bascule sur l'e-mail —", result.error);
  }

  const ok = await sendReminderEmail(booking);
  return { sent: ok, channel: ok ? "email" : null };
}

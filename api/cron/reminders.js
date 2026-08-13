/**
 * GET /api/cron/reminders — rappels de la veille.
 *
 * Déclenché une fois par jour par le cron Vercel déclaré dans vercel.json.
 * Sélectionne les rendez-vous du lendemain qui n'ont pas encore été rappelés,
 * envoie un SMS (ou un e-mail à défaut de numéro), puis horodate l'envoi.
 *
 * Comme la purge, l'endpoint exige CRON_SECRET : sans lui, il refuse de
 * s'exécuter plutôt que de rester ouvert.
 *
 * « Demain » se calcule en Europe/Brussels, jamais dans le fuseau du serveur.
 * Vercel déclenche en UTC : à 16h00 UTC, il est 18h00 à Bruxelles en été et
 * 17h00 en hiver. Le décalage saisonnier est sans conséquence pour un rappel,
 * mais c'est la date locale qui détermine quels rendez-vous sont concernés.
 */

import { SLOT_BY_ID, todayISO } from "../_lib/config.js";
import { isConfigured, sql } from "../_lib/db.js";
import { ensureSchema } from "../_lib/migrate.js";
import { sendReminder } from "../_lib/reminder.js";

/** Lendemain de la date civile belge, sans dérive de fuseau. */
function tomorrowISO() {
  const [y, m, d] = todayISO().split("-").map(Number);
  const cursor = new Date(Date.UTC(y, m - 1, d));
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  return cursor.toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[reminders] CRON_SECRET absent — rappels désactivés. Voir README.md.");
    return res.status(503).json({ ok: false, error: "Cron non configuré." });
  }
  if (req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false, error: "Non autorisé." });
  }

  if (!isConfigured()) {
    return res.status(503).json({ ok: false, error: "Base de données non configurée." });
  }

  try {
    await ensureSchema();

    const date = tomorrowISO();
    const bookings = await sql`
      select id,
             to_char(booking_date, 'YYYY-MM-DD') as booking_date,
             slot, session_type, name, email, phone, cancel_token
        from bookings
       where booking_date = ${date}::date
         and status in ('pending', 'confirmed')
         and reminder_sent_at is null
       order by slot
    `;

    if (!bookings.length) {
      console.log(`[reminders] aucun rendez-vous à rappeler pour le ${date}`);
      return res.status(200).json({ ok: true, date, total: 0, sms: 0, email: 0, failed: 0 });
    }

    const tally = { sms: 0, email: 0, failed: 0 };

    for (const row of bookings) {
      const booking = { ...row, slot_label: SLOT_BY_ID.get(row.slot)?.label ?? row.slot };
      const { sent, channel } = await sendReminder(booking);

      if (!sent) {
        // Pas d'horodatage : la tentative du lendemain reprendra ce rendez-vous.
        // Mieux vaut un rappel en retard que pas de rappel du tout.
        tally.failed++;
        console.error("[reminders] échec pour la réservation", row.id);
        continue;
      }

      tally[channel]++;
      await sql`update bookings set reminder_sent_at = now() where id = ${row.id}::uuid`;
    }

    console.log(
      `[reminders] ${date} — ${tally.sms} SMS, ${tally.email} e-mail(s), ${tally.failed} échec(s)`
    );
    return res.status(200).json({ ok: true, date, total: bookings.length, ...tally });
  } catch (err) {
    console.error("[reminders] erreur :", err);
    return res.status(500).json({ ok: false, error: "Erreur serveur." });
  }
}

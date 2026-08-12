/**
 * GET /api/calendar?token=… — flux iCalendar des rendez-vous.
 *
 * Patricia s'abonne à cette URL depuis l'application de calendrier de son
 * choix (Google, Apple, Outlook) : les rendez-vous y apparaissent et se
 * mettent à jour tout seuls, sans OAuth ni dépendance à un fournisseur.
 *
 * Le jeton est dérivé d'ADMIN_TOKEN par HMAC : partager l'URL du calendrier
 * ne donne aucun accès à l'administration.
 */

import { SLOT_BY_ID, TYPES, slotInstants } from "./_lib/config.js";
import { isCalendarToken } from "./_lib/auth.js";
import { isConfigured, sql } from "./_lib/db.js";
import { buildICS } from "./_lib/ics.js";

/** Fenêtre du flux : un peu de passé pour l'historique, large devant. */
const PAST_DAYS = 60;
const FUTURE_DAYS = 400;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).send("Méthode non autorisée");
  }

  if (!isCalendarToken(String(req.query?.token || ""))) {
    res.setHeader("X-Robots-Tag", "noindex");
    return res.status(403).send("Jeton invalide");
  }

  if (!isConfigured()) {
    return res.status(503).send("Base de données non configurée");
  }

  try {
    const rows = await sql`
      select id,
             to_char(booking_date, 'YYYY-MM-DD') as booking_date,
             slot, session_type, name, email, phone, message
        from bookings
       where status in ('pending', 'confirmed')
         and booking_date between current_date - ${PAST_DAYS}::int
                              and current_date + ${FUTURE_DAYS}::int
       order by booking_date, slot
    `;

    const events = rows.map((b) => {
      const { start, end } = slotInstants(b.booking_date, b.slot);
      const type = TYPES[b.session_type];
      const slotLabel = SLOT_BY_ID.get(b.slot)?.label ?? b.slot;
      return {
        uid: `${b.id}@instants-reflexo.be`,
        start,
        end,
        summary: `${b.name} — séance ${type?.label.toLowerCase() ?? b.session_type}`,
        description: [
          `Séance ${type?.label ?? b.session_type} (${type?.price ?? "?"} €)`,
          `Créneau : ${slotLabel}`,
          `Contact : ${b.email}${b.phone ? " · " + b.phone : ""}`,
          b.message ? `\nMessage : ${b.message}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      };
    });

    const ics = buildICS({ calName: "Instants Réflexo — rendez-vous", events });

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'inline; filename="instants-reflexo.ics"');
    // Les applications de calendrier interrogent le flux régulièrement :
    // un cache court suffit, tout en restant réactif après une réservation.
    res.setHeader("Cache-Control", "public, max-age=300");
    res.setHeader("X-Robots-Tag", "noindex");
    return res.status(200).send(ics);
  } catch (err) {
    console.error("[calendar] erreur :", err);
    return res.status(500).send("Erreur serveur");
  }
}

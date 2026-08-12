/**
 * /api/admin — administration réservée à Patricia.
 *
 * Authentification par jeton porteur (ADMIN_TOKEN), transmis par admin.html.
 *
 * GET   → rendez-vous à venir, disponibilités, dates bloquées, flux ICS
 * POST  → { action: "block" | "unblock" | "cancel" | "move", … }
 */

import { SLOT_BY_ID, TYPES, longLabel, nextFridays, siteURL } from "./_lib/config.js";
import { calendarToken, isAdmin } from "./_lib/auth.js";
import { isConfigured, isSlotTaken, sql } from "./_lib/db.js";
import { getAvailability, validateRequest } from "./_lib/availability.js";
import { sendCancellationEmail, sendMoveEmail } from "./_lib/mail.js";
import { ensureSchema } from "./_lib/migrate.js";

/**
 * L'administration n'est pas soumise au délai de prévenance : Patricia doit
 * pouvoir déplacer un rendez-vous vers demain matin si la situation l'exige.
 */
const ADMIN_MIN_NOTICE_HOURS = 0;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");

  if (!process.env.ADMIN_TOKEN) {
    console.error("[admin] ADMIN_TOKEN absent — administration désactivée. Voir README.md.");
    return res.status(503).json({ ok: false, error: "Administration non configurée." });
  }

  if (!isAdmin(req)) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="admin"');
    return res.status(401).json({ ok: false, error: "Jeton invalide." });
  }

  if (!isConfigured()) {
    return res.status(503).json({ ok: false, error: "Base de données non configurée." });
  }

  try {
    // Porte le schéma à niveau si le déploiement en a changé la forme.
    // Sans effet et sans requête une fois la fonction chaude.
    await ensureSchema();

    if (req.method === "GET") return await list(res);
    if (req.method === "POST") return await act(readBody(req), res);
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Méthode non autorisée" });
  } catch (err) {
    console.error("[admin] erreur :", err);
    return res.status(500).json({ ok: false, error: "Erreur serveur." });
  }
}

async function list(res) {
  const [bookings, blocked, availability] = await Promise.all([
    sql`
      select id,
             to_char(booking_date, 'YYYY-MM-DD') as booking_date,
             slot, session_type, price_cents, name, email, phone, message, status,
             to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as created_at
        from bookings
       where booking_date >= current_date - 14
       order by booking_date, slot
    `,
    sql`
      select to_char(blocked_date, 'YYYY-MM-DD') as blocked_date, reason
        from blocked_dates
       where blocked_date >= current_date
       order by blocked_date
    `,
    // Sert au sélecteur de déplacement : la page n'a ainsi jamais à deviner
    // quels créneaux sont libres, elle lit la même source que le public.
    getAvailability({ minNoticeHours: ADMIN_MIN_NOTICE_HOURS }),
  ]);

  return res.status(200).json({
    ok: true,
    calendarURL: `${siteURL()}/api/calendar?token=${calendarToken()}`,
    fridays: nextFridays(),
    availability,
    blocked,
    bookings: bookings.map((b) => ({
      ...b,
      slotLabel: SLOT_BY_ID.get(b.slot)?.label ?? b.slot,
      typeLabel: TYPES[b.session_type]?.label ?? b.session_type,
      dateLabel: longLabel(b.booking_date),
      price: b.price_cents / 100,
    })),
  });
}

async function act(body, res) {
  const action = String(body.action || "");

  if (action === "block") {
    const date = String(body.date || "");
    if (!ISO_DATE_RE.test(date)) {
      return res.status(400).json({ ok: false, error: "Date invalide." });
    }

    // Bloquer un jour qui porte déjà des rendez-vous serait trompeur :
    // l'index d'unicité les laisserait vivants alors que la journée
    // s'afficherait comme fermée. On l'interdit explicitement.
    const conflicts = await sql`
      select count(*)::int as count
        from bookings
       where booking_date = ${date}::date
         and status in ('pending', 'confirmed')
    `;
    if (conflicts[0].count > 0) {
      return res.status(409).json({
        ok: false,
        error: `${conflicts[0].count} rendez-vous sont déjà pris ce jour-là. Annulez-les d'abord.`,
      });
    }

    await sql`
      insert into blocked_dates (blocked_date, reason)
      values (${date}::date, ${String(body.reason || "").slice(0, 200) || null})
      on conflict (blocked_date) do update set reason = excluded.reason
    `;
    return res.status(200).json({ ok: true });
  }

  if (action === "unblock") {
    const date = String(body.date || "");
    if (!ISO_DATE_RE.test(date)) {
      return res.status(400).json({ ok: false, error: "Date invalide." });
    }
    await sql`delete from blocked_dates where blocked_date = ${date}::date`;
    return res.status(200).json({ ok: true });
  }

  if (action === "cancel") {
    const id = String(body.id || "");
    const [booking] = await sql`
      update bookings
         set status = 'cancelled', cancelled_at = now()
       where id = ${id}::uuid and status <> 'cancelled'
      returning id,
                to_char(booking_date, 'YYYY-MM-DD') as booking_date,
                slot, session_type, name, email, phone
    `;
    if (!booking) {
      return res.status(404).json({ ok: false, error: "Rendez-vous introuvable ou déjà annulé." });
    }
    if (body.notify !== false) {
      await sendCancellationEmail({
        ...booking,
        slot_label: SLOT_BY_ID.get(booking.slot)?.label ?? booking.slot,
      });
    }
    return res.status(200).json({ ok: true });
  }

  if (action === "move") return await move(body, res);

  return res.status(400).json({ ok: false, error: "Action inconnue." });
}

/**
 * Déplace un rendez-vous vers un autre créneau.
 *
 * La collision n'est pas testée avant l'écriture — elle est *empêchée* par
 * l'index unique partiel, comme pour une réservation publique. Deux
 * déplacements simultanés vers le même créneau ne peuvent pas passer tous
 * les deux : le second remonte en 23505 et devient un 409.
 */
async function move(body, res) {
  const id = String(body.id || "");
  const date = String(body.date || "");
  const slot = String(body.slot || "");

  if (!ISO_DATE_RE.test(date)) {
    return res.status(400).json({ ok: false, error: "Date invalide." });
  }

  const [current] = await sql`
    select id,
           to_char(booking_date, 'YYYY-MM-DD') as booking_date,
           slot, session_type, name, email, phone, revision, cancel_token
      from bookings
     where id = ${id}::uuid
       and status in ('pending', 'confirmed')
     limit 1
  `;
  if (!current) {
    return res.status(404).json({ ok: false, error: "Rendez-vous introuvable ou annulé." });
  }

  if (current.booking_date === date && current.slot === slot) {
    return res.status(400).json({ ok: false, error: "C'est déjà le créneau actuel." });
  }

  // Mêmes règles que pour une réservation publique — notamment le fait qu'une
  // séance personnalisée ne peut aller que sur un créneau qui l'accepte.
  const check = await validateRequest({
    date,
    slot,
    type: current.session_type,
    minNoticeHours: ADMIN_MIN_NOTICE_HOURS,
  });
  if (!check.ok) {
    return res.status(check.status).json({ ok: false, error: check.error });
  }

  let moved;
  try {
    [moved] = await sql`
      update bookings
         set booking_date = ${date}::date,
             slot = ${slot},
             revision = revision + 1
       where id = ${id}::uuid
         and status in ('pending', 'confirmed')
      returning id,
                to_char(booking_date, 'YYYY-MM-DD') as booking_date,
                slot, session_type, name, email, phone, revision, cancel_token
    `;
  } catch (err) {
    if (isSlotTaken(err)) {
      return res.status(409).json({
        ok: false,
        code: "slot_taken",
        error: "Ce créneau vient d'être pris. Choisissez-en un autre.",
      });
    }
    throw err;
  }

  if (!moved) {
    return res.status(404).json({ ok: false, error: "Rendez-vous introuvable ou annulé." });
  }

  let notified = true;
  if (body.notify !== false) {
    notified = await sendMoveEmail(
      { ...moved, slot_label: SLOT_BY_ID.get(moved.slot)?.label ?? moved.slot },
      { ...current, slot_label: SLOT_BY_ID.get(current.slot)?.label ?? current.slot }
    );
    if (!notified) {
      console.error("[admin] rendez-vous", moved.id, "déplacé mais e-mail non envoyé");
    }
  }

  return res.status(200).json({
    ok: true,
    notified,
    booking: {
      date: moved.booking_date,
      dateLabel: longLabel(moved.booking_date),
      slot: SLOT_BY_ID.get(moved.slot)?.label ?? moved.slot,
    },
  });
}

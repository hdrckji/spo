/**
 * /api/admin — administration réservée à Patricia.
 *
 * Authentification par jeton porteur (ADMIN_TOKEN), transmis par admin.html.
 *
 * GET   → rendez-vous à venir, dates bloquées, URL du flux ICS
 * POST  → { action: "block" | "unblock" | "cancel", … }
 */

import { SLOT_BY_ID, TYPES, longLabel, nextFridays, siteURL } from "./_lib/config.js";
import { adminTokenProblem, calendarToken, hashIP, isAdmin } from "./_lib/auth.js";
import { isConfigured, sql } from "./_lib/db.js";
import { sendCancellationEmail } from "./_lib/mail.js";
import {
  MAX_ADMIN_FAILURES,
  WINDOW_MINUTES,
  clearFailures,
  pause,
  recentFailures,
  recordFailure,
} from "./_lib/throttle.js";

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

  // Un jeton serveur inutilisable n'est pas un jeton refusé : on le dit
  // explicitement, sinon on cherche l'erreur du côté de la saisie.
  const problem = adminTokenProblem();
  if (problem) {
    console.error("[admin] administration désactivée —", problem);
    return res.status(503).json({
      ok: false,
      error: `Administration mal configurée sur le serveur : ${problem} Corrigez la variable dans Vercel, puis redéployez.`,
    });
  }

  if (!isConfigured()) {
    return res.status(503).json({ ok: false, error: "Base de données non configurée." });
  }

  /* ---- Limitation des tentatives ----
     C'est elle qui protège l'agenda, davantage que la longueur du jeton.
     Le compteur est vérifié avant l'authentification, sinon il suffirait de
     réessayer indéfiniment. */
  const ipHash = hashIP(req);
  try {
    if ((await recentFailures(ipHash)) >= MAX_ADMIN_FAILURES) {
      console.warn("[admin] trop de tentatives échouées, accès bloqué temporairement");
      res.setHeader("Retry-After", String(WINDOW_MINUTES * 60));
      return res.status(429).json({
        ok: false,
        error: `Trop de tentatives échouées. Réessayez dans ${WINDOW_MINUTES} minutes.`,
      });
    }

    if (!isAdmin(req)) {
      await recordFailure(ipHash);
      await pause();
      res.setHeader("WWW-Authenticate", 'Bearer realm="admin"');
      return res.status(401).json({ ok: false, error: "Jeton invalide." });
    }

    // Se tromper puis réussir ne doit pas laisser de trace pénalisante.
    await clearFailures(ipHash);
  } catch (err) {
    console.error("[admin] erreur lors du contrôle des tentatives :", err);
    return res.status(500).json({ ok: false, error: "Erreur serveur." });
  }

  try {
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
  const [bookings, blocked] = await Promise.all([
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
  ]);

  return res.status(200).json({
    ok: true,
    calendarURL: `${siteURL()}/api/calendar?token=${calendarToken()}`,
    fridays: nextFridays(),
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

  return res.status(400).json({ ok: false, error: "Action inconnue." });
}

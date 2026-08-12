/**
 * /api/cancel?token=… — annulation d'un rendez-vous par le client.
 *
 * GET  affiche une page de confirmation ; il ne modifie rien.
 *      C'est délibéré : les antivirus et aperçus de messagerie visitent les
 *      liens contenus dans les e-mails. Un GET destructeur annulerait des
 *      rendez-vous tout seul.
 * POST procède réellement à l'annulation et libère le créneau.
 */

import { TYPES, longLabel, CONTACT_EMAIL } from "./_lib/config.js";
import { isConfigured, sql } from "./_lib/db.js";
import { SLOT_BY_ID } from "./_lib/config.js";
import { sendCancellationEmail } from "./_lib/mail.js";

function escapeHTML(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

function page({ title, body, status = 200 }, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  return res.status(status).send(`<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${escapeHTML(title)} — Instants Réflexo</title>
  <style>
    :root { --cream:#f6f1e7; --ink:#2b3327; --forest:#3f5443; --forest-deep:#2e4034;
            --sage:#8a9b82; --terra:#c17a54; --white:#fdfbf6; }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; display:grid; place-items:center; padding:2rem 1.25rem;
           background:var(--cream); color:var(--ink);
           font-family:"Outfit","Helvetica Neue",Arial,sans-serif; line-height:1.6; }
    .card { max-width:34rem; width:100%; background:var(--white); border-radius:22px;
            padding:clamp(1.75rem,5vw,2.75rem); box-shadow:0 20px 60px -24px rgba(43,51,39,.25); }
    .eyebrow { font-size:.75rem; letter-spacing:.16em; text-transform:uppercase;
               color:var(--sage); margin:0 0 1.25rem; }
    h1 { font-family:Georgia,serif; font-weight:500; font-size:clamp(1.5rem,4vw,2rem);
         color:var(--forest-deep); margin:0 0 1rem; }
    dl { margin:1.5rem 0; padding:1.25rem; background:var(--cream); border-radius:14px; }
    dl div { display:flex; justify-content:space-between; gap:1rem; padding:.4rem 0; }
    dt { color:var(--sage); font-size:.9rem; }
    dd { margin:0; text-align:right; font-weight:500; }
    button { font:inherit; font-weight:500; cursor:pointer; border:0; border-radius:999px;
             padding:.9rem 1.75rem; background:var(--forest); color:var(--cream); width:100%; }
    button:hover { background:var(--forest-deep); }
    .muted { color:var(--sage); font-size:.9rem; }
    a { color:var(--terra); }
  </style>
</head>
<body>
  <main class="card">
    <p class="eyebrow">Instants Réflexo</p>
    ${body}
  </main>
</body>
</html>`);
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).send("Méthode non autorisée");
  }

  if (!isConfigured()) {
    return page(
      {
        status: 503,
        title: "Indisponible",
        body: `<h1>Service momentanément indisponible</h1>
               <p>Merci d'écrire directement à <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>`,
      },
      res
    );
  }

  const token = String(req.query?.token || "").trim();
  if (!token) {
    return page(
      { status: 400, title: "Lien invalide", body: `<h1>Lien d'annulation invalide</h1>
        <p>Le lien semble incomplet. Écrivez-nous à <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>` },
      res
    );
  }

  try {
    const [booking] = await sql`
      select id,
             to_char(booking_date, 'YYYY-MM-DD') as booking_date,
             slot, session_type, name, email, phone, status
        from bookings
       where cancel_token = ${token}
       limit 1
    `;

    if (!booking) {
      return page(
        { status: 404, title: "Introuvable", body: `<h1>Rendez-vous introuvable</h1>
          <p>Ce lien ne correspond à aucune réservation. Écrivez-nous à
          <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>` },
        res
      );
    }

    const slotLabel = SLOT_BY_ID.get(booking.slot)?.label ?? booking.slot;
    const typeLabel = TYPES[booking.session_type]?.label ?? booking.session_type;

    const recap = `<dl>
        <div><dt>Séance</dt><dd>${escapeHTML(typeLabel)}</dd></div>
        <div><dt>Date</dt><dd>${escapeHTML(longLabel(booking.booking_date))}</dd></div>
        <div><dt>Créneau</dt><dd>${escapeHTML(slotLabel)}</dd></div>
        <div><dt>Au nom de</dt><dd>${escapeHTML(booking.name)}</dd></div>
      </dl>`;

    if (booking.status === "cancelled") {
      return page(
        { title: "Déjà annulé", body: `<h1>Ce rendez-vous est déjà annulé</h1>${recap}
          <p class="muted">Le créneau a été remis à la disposition d'autres personnes.
          Pour reprendre rendez-vous, rendez-vous sur <a href="/#reservation">le site</a>.</p>` },
        res
      );
    }

    /* ---- GET : demander confirmation, ne rien modifier ---- */
    if (req.method === "GET") {
      return page(
        {
          title: "Annuler",
          body: `<h1>Annuler ce rendez-vous&nbsp;?</h1>${recap}
            <form method="post">
              <button type="submit">Confirmer l'annulation</button>
            </form>
            <p class="muted" style="margin-top:1.25rem;text-align:center;">
              Vous pouvez fermer cette page si vous souhaitez le conserver.
            </p>`,
        },
        res
      );
    }

    /* ---- POST : annulation effective ---- */
    const [updated] = await sql`
      update bookings
         set status = 'cancelled', cancelled_at = now()
       where id = ${booking.id} and status <> 'cancelled'
      returning id
    `;

    if (updated) {
      await sendCancellationEmail({ ...booking, slot_label: slotLabel });
    }

    return page(
      {
        title: "Annulé",
        body: `<h1>Rendez-vous annulé</h1>${recap}
          <p>C'est noté, et Patricia en est informée. Le créneau est de nouveau disponible.</p>
          <p class="muted">Vous serez toujours la bienvenue —
          <a href="/#reservation">reprendre rendez-vous</a>.</p>`,
      },
      res
    );
  } catch (err) {
    console.error("[cancel] erreur :", err);
    return page(
      { status: 500, title: "Erreur", body: `<h1>Une erreur est survenue</h1>
        <p>Merci d'écrire à <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>
        pour annuler votre rendez-vous.</p>` },
      res
    );
  }
}

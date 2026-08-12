/**
 * GET /api/cron/purge — purge quotidienne (RGPD, limitation de conservation).
 *
 * Déclenché par le cron Vercel déclaré dans vercel.json. Vercel envoie
 * l'en-tête `Authorization: Bearer $CRON_SECRET` ; sans CRON_SECRET défini,
 * l'endpoint refuse de s'exécuter plutôt que de rester ouvert.
 *
 * Supprime les réservations de plus de RETENTION_MONTHS mois et les traces
 * de limitation de débit de plus de 7 jours.
 */

import { isConfigured, sql } from "../_lib/db.js";
import { ensureSchema } from "../_lib/migrate.js";

const RETENTION_MONTHS = Number(process.env.RETENTION_MONTHS || 12);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[purge] CRON_SECRET absent — purge désactivée. Voir README.md.");
    return res.status(503).json({ ok: false, error: "Cron non configuré." });
  }
  if (req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false, error: "Non autorisé." });
  }

  if (!isConfigured()) {
    return res.status(503).json({ ok: false, error: "Base de données non configurée." });
  }

  try {
    // Porte le schéma à niveau si le déploiement en a changé la forme.
    // Sans effet et sans requête une fois la fonction chaude.
    await ensureSchema();

    const [result] = await sql`select * from purge_old_data(${RETENTION_MONTHS})`;
    console.log(
      `[purge] ${result.deleted_bookings} réservation(s) et ${result.deleted_attempts} trace(s) supprimées.`
    );
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error("[purge] erreur :", err);
    return res.status(500).json({ ok: false, error: "Erreur serveur." });
  }
}

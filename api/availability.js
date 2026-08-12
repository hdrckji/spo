/**
 * GET /api/availability
 *
 * Renvoie les vendredis proposés, les créneaux et leur disponibilité réelle,
 * ainsi que les types de séance et leurs tarifs. Le navigateur rend cette
 * réponse telle quelle : il ne détient plus ni les tarifs ni les créneaux.
 */

import { getAvailability } from "./_lib/availability.js";
import { isConfigured } from "./_lib/db.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Méthode non autorisée" });
  }

  // Les disponibilités changent à chaque réservation : jamais de cache.
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (!isConfigured()) {
    console.error("[availability] DATABASE_URL absente — voir README.md.");
    return res.status(503).json({
      ok: false,
      error: "Le module de réservation est momentanément indisponible.",
    });
  }

  try {
    const data = await getAvailability();
    return res.status(200).json({ ok: true, ...data });
  } catch (err) {
    console.error("[availability] erreur :", err);
    return res.status(500).json({
      ok: false,
      error: "Impossible de charger les disponibilités.",
    });
  }
}

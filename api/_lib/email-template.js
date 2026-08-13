/**
 * Gabarit des e-mails adressés aux clientes.
 *
 * Contraintes propres au courrier électronique, qui expliquent la forme du
 * code ci-dessous :
 *   - mise en page en tableaux, jamais en flex ni en grid : Outlook ignore
 *     l'un et l'autre ;
 *   - styles en ligne uniquement, les feuilles de style étant retirées par
 *     la plupart des messageries ;
 *   - polices systèmes, aucun appel réseau ;
 *   - largeur fixée à 560 px, repliée par les clients mobiles.
 *
 * Les trois messages — confirmation, déplacement, rappel — partagent ce
 * gabarit plutôt que d'en recopier trois variantes qui divergeraient.
 */

import { CONTACT_EMAIL, PLACE } from "./config.js";

export const COLORS = {
  cream: "#f6f1e7",
  creamDark: "#efe7d6",
  line: "#e7dcc6",
  white: "#fdfbf6",
  ink: "#2b3327",
  forest: "#3f5443",
  forestDeep: "#2e4034",
  sage: "#8a9b82",
  terra: "#c17a54",
  terraPale: "#fbf3ec",
};

export function escapeHTML(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "-apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/** Lien vers la carte, pour que l'adresse s'ouvre d'un doigt sur téléphone. */
export function mapsURL() {
  const q = `${PLACE.street}, ${PLACE.postalCode} ${PLACE.city}, ${PLACE.country}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/**
 * Bandeau de date : l'information qu'on cherche des mois plus tard en
 * rouvrant le message. Elle est donc seule, grande, et en haut.
 */
export function dateBanner({ weekday, dayMonth, time }) {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background:${COLORS.forestDeep};border-radius:14px;">
    <tr>
      <td align="center" style="padding:26px 20px;">
        <div style="font-family:${SANS};font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#b9c4ae;padding-bottom:8px;">${escapeHTML(weekday)}</div>
        <div style="font-family:${SERIF};font-size:30px;line-height:1.15;color:${COLORS.cream};padding-bottom:10px;">${escapeHTML(dayMonth)}</div>
        <div style="font-family:${SANS};font-size:19px;font-weight:600;color:#dba888;">${escapeHTML(time)}</div>
      </td>
    </tr>
  </table>`;
}

/** Ligne d'un tableau de détails : intitulé à gauche, valeur à droite. */
export function detailRow(label, value, { last = false } = {}) {
  const border = last ? "" : `border-bottom:1px solid ${COLORS.line};`;
  return `
    <tr>
      <td style="padding:13px 0;${border}font-family:${SANS};font-size:14px;color:${COLORS.sage};vertical-align:top;white-space:nowrap;">${escapeHTML(label)}</td>
      <td align="right" style="padding:13px 0;${border}font-family:${SANS};font-size:14px;color:${COLORS.ink};vertical-align:top;">${value}</td>
    </tr>`;
}

export function detailsTable(rows) {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    ${rows.join("")}
  </table>`;
}

/** Bouton en tableau : la seule forme qui survive à Outlook. */
export function button(href, label, { subtle = false } = {}) {
  const bg = subtle ? "transparent" : COLORS.terra;
  const color = subtle ? COLORS.terra : "#ffffff";
  const border = subtle ? `1px solid ${COLORS.line}` : "none";
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
    <tr>
      <td align="center" style="background:${bg};border:${border};border-radius:999px;">
        <a href="${escapeHTML(href)}"
           style="display:inline-block;padding:13px 28px;font-family:${SANS};font-size:14px;font-weight:600;color:${color};text-decoration:none;">${escapeHTML(label)}</a>
      </td>
    </tr>
  </table>`;
}

/** Encadré des précautions, repris tel quel dans plusieurs messages. */
export function precautionsBox() {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background:${COLORS.terraPale};border-radius:12px;">
    <tr>
      <td style="padding:16px 18px;font-family:${SANS};">
        <div style="font-size:14px;font-weight:600;color:${COLORS.forestDeep};padding-bottom:8px;">Merci de reporter votre séance si&nbsp;:</div>
        <div style="font-size:13px;line-height:1.75;color:#5a6553;">
          &middot;&nbsp; vous avez une prise de sang dans les 15 jours qui viennent<br>
          &middot;&nbsp; vous êtes enceinte de moins de trois mois<br>
          &middot;&nbsp; vous avez été opéré&middot;e il y a moins d'un mois, ou une opération est prévue
        </div>
      </td>
    </tr>
  </table>`;
}

/**
 * Enveloppe complète du message.
 *
 * @param {object} o
 * @param {string} o.preheader  texte d'aperçu affiché dans la liste des messages
 * @param {string} o.heading    titre principal
 * @param {string} o.intro      paragraphe d'introduction (HTML autorisé)
 * @param {string} o.body       contenu, déjà en HTML
 */
export function shell({ preheader, heading, intro, body }) {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHTML(heading)}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.cream};">
  <!-- Aperçu dans la liste des messages, invisible à l'ouverture -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHTML(preheader)}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background:${COLORS.cream};">
    <tr>
      <td align="center" style="padding:28px 14px 40px;">

        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"
               style="width:100%;max-width:560px;">

          <!-- En-tête -->
          <tr>
            <td align="center" style="padding:6px 0 22px;">
              <span style="font-family:${SERIF};font-size:21px;color:${COLORS.forestDeep};">Instants
                <span style="font-style:italic;color:${COLORS.terra};">Réflexo</span></span>
            </td>
          </tr>

          <!-- Carte -->
          <tr>
            <td style="background:${COLORS.white};border-radius:18px;padding:32px 30px;">

              <h1 style="margin:0 0 14px;font-family:${SERIF};font-size:25px;font-weight:normal;line-height:1.25;color:${COLORS.forestDeep};">${escapeHTML(heading)}</h1>
              <div style="font-family:${SANS};font-size:15px;line-height:1.65;color:#5a6553;padding-bottom:24px;">${intro}</div>

              ${body}

            </td>
          </tr>

          <!-- Pied -->
          <tr>
            <td align="center" style="padding:22px 16px 0;font-family:${SANS};font-size:12px;line-height:1.7;color:${COLORS.sage};">
              Instants Réflexo — Patricia Valck<br>
              <a href="mailto:${CONTACT_EMAIL}" style="color:${COLORS.sage};">${CONTACT_EMAIL}</a>
              &nbsp;·&nbsp; ${escapeHTML(PLACE.street)}, ${escapeHTML(PLACE.postalCode)} ${escapeHTML(PLACE.city)}<br>
              <span style="color:#a8b3a0;">La réflexologie plantaire ne se substitue pas à un avis ou un traitement médical.</span>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

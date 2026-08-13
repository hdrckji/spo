/**
 * Régénère db/schema.sql à partir de api/_lib/schema.js.
 *
 *     npm run schema:sql
 *
 * Le fichier SQL n'est plus nécessaire au déploiement — la migration se fait
 * toute seule. Il reste utile pour relire le schéma, l'appliquer à la main,
 * ou repartir d'une base vierge.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SCHEMA_VERSION, STATEMENTS } from "../api/_lib/schema.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const header = `-- ============================================================
--  Instants Réflexo — schéma de la base de réservation
--
--  FICHIER GÉNÉRÉ — ne le modifiez pas à la main.
--  Source : api/_lib/schema.js · régénérer avec \`npm run schema:sql\`
--
--  Vous n'avez normalement pas à l'exécuter : le schéma se met à niveau
--  tout seul au premier appel suivant un déploiement (api/_lib/migrate.js).
--  Il reste là pour relire le schéma ou repartir d'une base vierge.
--
--  Version du schéma : ${SCHEMA_VERSION}
--  Le script est idempotent : le rejouer ne casse rien.
-- ============================================================
`;

const body = STATEMENTS.map((s) => s.trim().replace(/\n {3}/g, "\n") + ";\n").join("\n");

const footer = `
insert into schema_meta (key, value, updated_at)
values ('version', '${SCHEMA_VERSION}', now())
on conflict (key) do update
  set value = excluded.value, updated_at = now();
`;

writeFileSync(join(root, "db", "schema.sql"), header + "\n" + body + footer, "utf8");
console.log(`db/schema.sql régénéré — ${STATEMENTS.length} instructions, version ${SCHEMA_VERSION}.`);

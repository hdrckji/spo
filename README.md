# Instants Réflexo

Site de Patricia Valck, réflexologue plantaire à Péruwelz (Belgique), avec
réservation en ligne.

HTML, CSS et JavaScript sans framework ni étape de build. Le module de
réservation s'appuie sur des fonctions serverless Vercel et une base Postgres
(Neon). Une seule dépendance npm : le driver HTTP de Neon.

---

## Sommaire

- [Architecture](#architecture)
- [Mise en service](#mise-en-service)
- [Variables d'environnement](#variables-denvironnement)
- [Administration](#administration)
- [Développement local](#développement-local)
- [Points ouverts](#points-ouverts)

---

## Architecture

```
index.html          page publique (une seule page, 5 sections)
admin.html          agenda de Patricia, protégé par jeton
styles.css          design system maison (variables CSS)
script.js           navigation, animations, module de réservation
robots.txt          /admin.html et /api exclus de l'indexation
sitemap.xml
vercel.json         cron de purge + en-têtes de sécurité
db/schema.sql       schéma Postgres, idempotent

api/
  availability.js   GET  — vendredis, créneaux et disponibilité réelle
  reserve.js        POST — enregistrement d'une réservation
  cancel.js         GET/POST — annulation par le client
  calendar.js       GET  — flux iCalendar à synchroniser
  admin.js          GET/POST — rendez-vous, congés
  cron/purge.js     GET  — purge RGPD quotidienne
  _lib/
    config.js       créneaux, tarifs, lieu, calculs de dates
    availability.js composition des disponibilités + revalidation
    db.js           client Neon
    mail.js         envois Resend (praticienne + client)
    ics.js          génération iCalendar
    auth.js         jetons et hachage d'IP
```

Les fichiers du dossier `_lib` ne sont pas exposés : Vercel ignore tout
chemin préfixé par `_`.

### Le principe

**La base est la seule source de vérité.** Le navigateur ne connaît ni les
tarifs, ni les créneaux : il les reçoit de `/api/availability` et
`/api/reserve` revalide tout avant d'écrire.

**Pas de double réservation.** La garantie ne vient pas du code applicatif
mais d'un index unique partiel :

```sql
create unique index one_booking_per_slot
  on bookings (booking_date, slot)
  where status in ('pending', 'confirmed');
```

Deux personnes qui confirment le même créneau au même instant&nbsp;? La seconde
insertion échoue avec le code Postgres `23505`, l'API répond `409`, et le
navigateur recharge les disponibilités puis affiche l'état réel. Aucun verrou
applicatif à raisonner, aucune fenêtre de course.

**La disponibilité est une composition**, pas une lecture de table :

```
occupé = réservations vivantes ∪ jours de congé ∪ délai de prévenance
```

Brancher un agenda externe plus tard consiste à ajouter une source à cette
union, dans `api/_lib/availability.js` — sans toucher au reste.

---

## Mise en service

### 1. Base de données

Créez un projet [Neon](https://neon.tech) **en région européenne**
(`eu-central-1`, Francfort) — les données contiennent des informations
personnelles de résidents belges.

Ouvrez l'éditeur SQL du projet et exécutez le contenu de `db/schema.sql`.
Le script est idempotent : le rejouer après une modification ne casse rien.

Copiez la chaîne de connexion *pooled* (celle qui contient `-pooler`) :
c'est la valeur de `DATABASE_URL`.

### 2. Envoi des e-mails

Créez un compte [Resend](https://resend.com), vérifiez le domaine
`instants-reflexo.be`, puis générez une clé API.

Sans domaine vérifié, Resend n'autorise que l'expéditeur
`onboarding@resend.dev`, utilisable pour un test mais pas en production : les
messages partent alors avec une adresse qui n'est pas celle du cabinet.

### 3. Secrets

Générez deux secrets distincts :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Le premier devient `ADMIN_TOKEN`, le second `CRON_SECRET`.

### 4. Déploiement

Renseignez les variables ci-dessous dans **Vercel → Settings → Environment
Variables**, puis déployez. Vercel installe la dépendance et publie les
fonctions du dossier `api/` automatiquement — il n'y a pas d'étape de build.

---

## Variables d'environnement

| Variable | Requise | Rôle |
|---|---|---|
| `DATABASE_URL` | **oui** | Chaîne de connexion Neon (pooled). Sans elle, la réservation répond `503` au lieu de faire semblant de fonctionner. |
| `ADMIN_TOKEN` | **oui** | Ouvre `/admin.html`. Sert aussi de sel au hachage des IP et à dériver le jeton du flux ICS. Minimum 24 caractères. |
| `RESEND_API_KEY` | **oui** en production | Clé API Resend. Absente, la réservation est **quand même enregistrée** et l'utilisateur est informé que l'e-mail n'est pas parti. |
| `RESEND_FROM` | non | Expéditeur vérifié. Défaut : `Instants Réflexo <contact@instants-reflexo.be>`. |
| `RESERVATION_EMAIL` | non | Destinataire des notifications. Défaut : `contact@instants-reflexo.be`. |
| `SITE_URL` | recommandée | URL publique, pour les liens d'annulation. Défaut : l'URL du déploiement Vercel. |
| `CRON_SECRET` | non | Protège `/api/cron/purge`. Sans elle, la purge refuse de s'exécuter. |
| `RETENTION_MONTHS` | non | Durée de conservation des réservations. Défaut : `12`. |

Aucune variable n'a de valeur de repli silencieuse : quand il en manque une,
l'API répond une erreur explicite et l'écrit dans les journaux Vercel.

---

## Administration

### L'agenda

`https://instants-reflexo.be/admin.html`

Patricia y colle son `ADMIN_TOKEN` une fois ; il est retenu pour la session.
Pour un accès en un clic, mettez en favori l'URL avec le jeton en fragment :

```
https://instants-reflexo.be/admin.html#LE_JETON
```

Le fragment n'est jamais transmis au serveur, et la page l'efface de la barre
d'adresse dès qu'elle l'a lu.

Depuis cette page : consulter les rendez-vous, **en déplacer un**, en annuler
un, bloquer ou rouvrir un vendredi. Le client est prévenu par e-mail dans les
deux premiers cas.

**Le déplacement** propose uniquement les créneaux réellement libres, et pour
une séance personnalisée uniquement ceux qui acceptent le moxa et le Psio.
La collision n'est pas testée avant l'écriture : elle est empêchée par le
même index unique que les réservations publiques, donc deux déplacements
simultanés vers le même créneau ne peuvent pas aboutir tous les deux.

L'e-mail envoyé au client porte un `.ics` de même UID que l'original, avec un
`SEQUENCE` incrémenté (colonne `revision`). Les applications de calendrier
**mettent donc à jour** le rendez-vous existant au lieu d'en ajouter un
second à côté de l'ancien.

L'administration n'est pas soumise au délai de prévenance de 24 h : Patricia
peut déplacer un rendez-vous vers le lendemain matin si la situation l'exige.

Bloquer un jour qui porte déjà des rendez-vous est refusé — il faudrait sinon
annuler les rendez-vous d'abord, ce que l'interface demande explicitement.

### Le calendrier sur téléphone

La page d'administration affiche une adresse `https` à copier dans Google
Agenda, Apple Calendrier ou Outlook (« ajouter un calendrier par URL »). Les
rendez-vous s'y synchronisent tout seuls, sans OAuth et sans dépendre d'un
fournisseur particulier.

Le jeton de cette adresse est dérivé d'`ADMIN_TOKEN` par HMAC : la partager
ne donne aucun accès à l'administration. Elle expose en revanche les
coordonnées des clients — elle reste donc privée.

### Changer un créneau ou un tarif

Tout est dans `api/_lib/config.js` : `SLOTS`, `TYPES`, `WEEKS_AHEAD`,
`MIN_NOTICE_HOURS`. Le site public se met à jour au déploiement suivant, sans
migration.

---

## Développement local

```bash
npm install
npx vercel dev
```

Créez un fichier `.env.local` (ignoré par git) avec au minimum `DATABASE_URL`
et `ADMIN_TOKEN`. Sans `RESEND_API_KEY`, les réservations s'enregistrent et
l'absence d'envoi est signalée dans la console — pas d'e-mail parti en douce.

Un point de vigilance : **toutes les dates sont calculées en
`Europe/Brussels`**, jamais dans le fuseau du serveur. C'est délibéré. La
version précédente utilisait `new Date().toISOString().slice(0, 10)`, qui
renvoie la date UTC : à minuit heure belge, l'UTC est encore la veille, et un
vendredi partait en base comme le jeudi précédent. `api/_lib/config.js`
concentre ces calculs — évitez de les refaire ailleurs.

---

## Points ouverts

Ces sujets ne sont pas traités par ce dépôt et demandent une décision ou des
informations qui n'y figurent pas.

- **Mentions légales et politique de confidentialité.** Obligatoires pour un
  site belge qui collecte des données personnelles (numéro d'entreprise BCE,
  responsable de traitement, finalité, durée de conservation, droits des
  personnes). La durée de conservation est en place techniquement
  (`RETENTION_MONTHS` + purge quotidienne) ; le texte, non.
- **Consentement aux cookies tiers.** L'iframe Google Maps et les Google
  Fonts déposent des cookies et transmettent l'adresse IP du visiteur avant
  tout consentement. Deux corrections possibles : héberger les polices avec
  le site, et remplacer la carte par une image cliquable qui ne charge
  l'iframe qu'après accord.
- **Synchronisation bidirectionnelle avec un agenda.** Le flux ICS est en
  lecture seule : les congés posés dans Google Agenda ne remontent pas au
  site. Il faut pour cela les saisir dans `/admin.html`. Le jour où un
  fournisseur sera choisi, la lecture s'ajoute comme source supplémentaire
  dans `api/_lib/availability.js`.

# Espace étudiant — Planning de stage

Un espace web permettant aux étudiants du service de **consulter et modifier
leur planning de stage hebdomadaire**, dont les données sont dans le document
Grist **GESTION-ETUDIANT** (instance DINUM, CHR Metz-Thionville).

Les étudiants n'ont **pas besoin de compte Grist** : ils se connectent avec
leur **code anonymat** (1ère lettre du prénom + date de naissance JJMMAA +
1ère lettre du nom — ex. Jean DUPONT né le 15/03/1998 → `J150398D`).

## Architecture

```
Étudiant ──▶ Site web (GitHub Pages, dossier docs/)
                 │  code anonymat
                 ▼
             Proxy API (Cloudflare Worker, dossier worker/)
                 │  clé API Grist (secrète, jamais côté navigateur)
                 ▼
             Document Grist GESTION-ETUDIANT (DINUM)
```

Le proxy garantit que chaque étudiant ne voit et ne modifie **que son propre
planning** (semaines liées à ses périodes de stage).

## Tables Grist utilisées

Le proxy s'appuie sur la structure existante du document :

| Table | Usage |
|---|---|
| `LISTE_DES_ETUDIANTS` | Authentification via la colonne `Anonymat` ; nom/prénom |
| `PERIODES_DE_STAGE` | Périodes de l'étudiant (`Code_anonymat`, `Du`, `Au`, `Service`, `En_cours`, heures) |
| `PLANNING_HEBDO` | Une ligne par semaine ; `Lundi`…`Dimanche` → codes horaires ; l'étudiant peut créer et modifier ses semaines |
| `CODES_HORAIRES` | Référentiel des codes (M, S, N, R, ABS…) — lecture seule |
| `SERVICES` | Nom du service affiché — lecture seule |

Ce que le proxy autorise :
- lire son profil, ses périodes, ses semaines et le référentiel des codes ;
- **modifier** les jours (`Lundi`…`Dimanche`) et le `Commentaire` de ses semaines ;
- **créer** une nouvelle semaine sur une de ses périodes (doublon refusé).

Rien d'autre : pas de suppression, pas d'accès aux autres tables (évaluations,
utilisateurs, etc.), pas d'accès aux données des autres étudiants.

## 1. Clé API Grist

1. Sur Grist : avatar en haut à droite → **Paramètres du profil** → **Clé API** → créer/copier la clé.
2. Le compte associé doit avoir accès en écriture au document GESTION-ETUDIANT.

## 2. Déployer le proxy (Cloudflare Workers)

Prérequis : un compte gratuit sur [cloudflare.com](https://dash.cloudflare.com/sign-up)
et Node.js installé.

```bash
cd worker
npm install
npx wrangler login                        # ouvre le navigateur pour autoriser
npx wrangler secret put GRIST_API_KEY     # colle ta clé API Grist
npx wrangler deploy
```

`wrangler deploy` affiche l'URL du worker, par exemple
`https://espace-etudiant-api.moncompte.workers.dev`.

## 3. Configurer et publier le site (GitHub Pages)

1. Dans `docs/config.js`, remplace `API_URL` par l'URL de ton worker.
2. Pousse le dépôt sur GitHub, puis dans **Settings → Pages** du dépôt :
   *Source* = branche `main`, dossier `/docs`.
3. Le site est disponible sous `https://toncompte.github.io/nom-du-depot/`.
4. **Sécurité** : dans `worker/wrangler.toml`, remplace `ALLOWED_ORIGIN = "*"`
   par l'origine de ton site (ex. `"https://toncompte.github.io"`) et
   redéploie (`npx wrangler deploy`).

## Sécurité — points d'attention

- La clé API Grist n'est stockée **que** dans le secret Cloudflare, jamais dans
  le code ni sur GitHub.
- ⚠️ Le code anonymat est **devinable** par quiconque connaît le nom et la date
  de naissance d'un étudiant (format documenté sur l'écran de connexion).
  C'est un choix assumé de simplicité ; les données exposées se limitent au
  planning de stage. Pour durcir : ajouter un suffixe aléatoire aux codes.
- Le proxy ne permet ni suppression ni accès aux tables sensibles du document.

## Développement local

```bash
cd worker && npx wrangler dev        # proxy sur http://localhost:8787
# puis mettre API_URL: "http://localhost:8787" dans docs/config.js
# et servir docs/ (ex. python3 -m http.server 4173 --directory docs)
```

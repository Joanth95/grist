# Guide d'installation — déployer une copie sur un autre site

> ⚠️ Ce projet est protégé par tous droits réservés (voir [LICENSE](LICENSE)) :
> ce guide ne vous autorise pas, à lui seul, à déployer une copie. Contactez
> d'abord l'auteur (Joan Thuillier, CHR Metz-Thionville) pour obtenir son
> accord écrit ; ce n'est qu'après cet accord que les étapes ci-dessous
> s'appliquent.

Ce guide sert à remonter **une instance indépendante** de l'application
(document Grist propre + Worker Cloudflare propre + site propre) pour un
autre service, un autre pôle ou un autre établissement. Il ne modifie pas
l'installation actuelle (CHR Metz-Thionville).

Comptez environ 1h la première fois. Prérequis : un compte
[Grist DINUM](https://grist.numerique.gouv.fr) (ou une autre instance Grist),
un compte [Cloudflare](https://dash.cloudflare.com/sign-up) (gratuit), un
compte GitHub, et Node.js installé sur votre poste.

---

## Étape 1 — Le document Grist

Deux façons de procéder selon votre situation.

### Option A — Vous avez accès au document d'origine (recommandé)

1. Ouvrez le document **GESTION-ETUDIANT**, menu **Fichier → Faire une copie**
   (ou « Dupliquer »), et choisissez l'organisation/espace de destination.
   Toutes les tables, colonnes et formules sont copiées automatiquement.
2. Dans la copie, videz les tables de **données** (gardez les tables de
   **référence**) :
   - À vider : `LISTE_DES_ETUDIANTS`, `PERIODES_DE_STAGE`, `PLANNING_HEBDO`,
     `Sortie_de_stage`, `EVALUATION_STAGE_ETUDIANT`.
   - À adapter (ne pas vider, juste modifier le contenu) : `SERVICES`,
     `UTILISATEURS`, `CODES_HORAIRES`, `JOURS_FERIES`, `Pole`, `SITES`.
3. Passez directement à l'étape « Adapter les données de référence » plus bas.

### Option B — Vous partez d'un document Grist vide

Recréez les tables et colonnes selon le schéma détaillé en **annexe** en fin
de document. C'est plus long : à réserver au cas où vous n'avez pas accès au
document d'origine (nouvel établissement, nouvelle organisation Grist).

### Adapter les données de référence (les deux options)

- **`SERVICES`** : une ligne par service accueillant des étudiants.
  - `Nom`, `Code_UF`, `Recoit_des_etudiant` (case à cocher).
  - `Cadre_ref` : référence vers la ligne `UTILISATEURS` du cadre responsable.
- **`UTILISATEURS`** : une ligne par cadre.
  - `Nom`, `Prenom`, `Civilite`, `Telephone`.
  - `Email` est une **formule** qui construit l'adresse à partir de
    `Prenom.Nom@chr-metz-thionville.fr` — **à modifier** avec le domaine mail
    de votre établissement (colonne formule, panneau latéral « Colonne »).
  - `Code_acces` (Texte) : à remplir vous-même pour chaque cadre — un code
    personnel assez long/aléatoire (10-12 caractères), transmis en dehors de
    l'outil. C'est ce code + l'email qui donnent accès à l'espace cadre.
- **`CODES_HORAIRES`** : gardez ou adaptez les codes (M, S, N, R, ABS, RF…),
  leurs horaires et si chacun compte comme temps de stage.
- **`JOURS_FERIES`** : liste des jours fériés à jour pour l'année en cours.
- **`Lien_evaluation`** (formule sur `PERIODES_DE_STAGE`) pointe vers un
  formulaire Grist spécifique au document d'origine
  (`https://grist.../forms/i2DQ6z2zoh8vjYpznkJrEx/124?Cle_lien=...`). Si vous
  voulez garder la fonctionnalité d'évaluation de stage, recréez un
  formulaire Grist sur la table `EVALUATION_STAGE_ETUDIANT` (champ caché
  `Cle_lien` prérempli), publiez-le, et mettez à jour cette formule avec la
  nouvelle URL. Sinon, laissez tel quel : l'onglet « Envoi des évaluations »
  affichera juste « Lien non généré ».

---

## Étape 2 — Récupérer une clé API Grist

1. Sur Grist : avatar en haut à droite → **Paramètres du profil** → **Clé
   API** → créer/copier la clé.
2. Le compte associé doit avoir un accès en **écriture** au nouveau document.
3. Notez aussi l'**identifiant du document** : dans son URL,
   `.../o/<organisation>/<DOC_ID>/GESTION-ETUDIANT`.

---

## Étape 3 — Déployer le Worker (proxy Cloudflare)

```bash
git clone https://github.com/Joanth95/grist.git mon-espace-etudiant
cd mon-espace-etudiant/worker
npm install
npx wrangler login                        # ouvre le navigateur pour autoriser
```

Dans `worker/wrangler.toml`, adaptez :

```toml
name = "mon-espace-etudiant-api"          # nom unique sur votre compte Cloudflare

[vars]
GRIST_BASE_URL = "https://grist.numerique.gouv.fr/api"   # ou l'URL de votre instance Grist
GRIST_DOC_ID = "VOTRE_DOC_ID"              # récupéré à l'étape 2
ALLOWED_ORIGIN = "https://votrecompte.github.io"   # à finaliser après l'étape 4
```

Puis :

```bash
npx wrangler secret put GRIST_API_KEY     # colle la clé API Grist de l'étape 2
npx wrangler deploy
```

`wrangler deploy` affiche l'URL du worker, par exemple
`https://mon-espace-etudiant-api.votrecompte.workers.dev` — notez-la.

---

## Étape 4 — Publier le site (GitHub Pages)

1. Dans `docs/config.js`, remplacez `API_URL` par l'URL du worker obtenue à
   l'étape 3.
2. Poussez le dépôt sur **votre propre** GitHub (créez un nouveau dépôt,
   changez le `git remote`, `git push`).
3. Dans **Settings → Pages** du dépôt : *Source* = branche `main`, dossier
   `/docs`. Le site est alors disponible sous
   `https://votrecompte.github.io/nom-du-depot/`.
4. Revenez dans `worker/wrangler.toml`, mettez à jour `ALLOWED_ORIGIN` avec
   cette URL exacte, puis `npx wrangler deploy` à nouveau (sécurité : sans
   cette étape, n'importe quel site peut appeler votre proxy).

---

## Étape 5 — Personnaliser l'habillage (nom, établissement, crédits)

Le nom du développeur, du pôle et de l'établissement sont écrits en dur dans
plusieurs fichiers HTML (pied de page, page de connexion, mode d'emploi).
Cherchez-remplacez ces textes dans les fichiers suivants :

- `docs/index.html`, `docs/entree-stage.html`, `docs/espace-cadre.html`
- `docs/guide-etudiant.html`, `docs/guide-cadre.html`
- `docs/espace-cadre.js` (footer du planning imprimé)
- `docs/planning-cadre.html`, `docs/planning-serviceV2.html` (widgets Grist)
- `docs/envoyer-evaluation.html` (signature de mail par défaut)

Textes à remplacer :
- `M. Joan THUILLIER, Cadre de Santé Apprenant` → votre nom/fonction
- `Pôle 9 Gérontologie-Gériatrie` → votre pôle/service
- `CHR Metz-Thionville` → votre établissement

Pensez aussi à incrémenter les numéros de version en cache-busting
(`?v=N` sur les `<script>`/`<link>`) si vous modifiez ces fichiers, sans quoi
certains navigateurs garderont l'ancienne version en cache.

---

## Étape 6 — Distribuer les accès

- **Étudiants** : aucun compte à créer, ils s'inscrivent eux-mêmes via
  `entree-stage.html` (code anonymat calculé automatiquement).
- **Cadres** : transmettez à chacun son email professionnel + le
  `Code_acces` que vous avez saisi à l'étape 1, avec l'URL
  `https://votrecompte.github.io/nom-du-depot/espace-cadre.html`.

---

## Étape 7 — Vérifications

- [ ] `docs/index.html` : connexion avec un code anonymat de test.
- [ ] `entree-stage.html` : auto-inscription d'un étudiant fictif.
- [ ] `espace-cadre.html` : connexion cadre, chaque onglet (Déclarations,
      Dossier, Planning, Évaluations) affiche les bonnes données du service.
- [ ] Édition d'une case de planning, validation d'une déclaration : les
      changements apparaissent bien dans le document Grist.
- [ ] Un site **différent** du vôtre ne peut pas appeler votre worker
      (`ALLOWED_ORIGIN` correctement restreint).

---

## Développement local

```bash
cd worker && npx wrangler dev        # proxy sur http://localhost:8787
# puis mettre API_URL: "http://localhost:8787" dans docs/config.js
# et servir docs/ (ex. python3 -m http.server 4173 --directory docs)
```

---

## Annexe — Schéma des tables Grist requises

Colonnes strictement nécessaires au fonctionnement du Worker (noms exacts —
la casse et les caractères comptent, Grist les fige à la création tant que
`untieColIdFromLabel` n'est pas utilisé pour les renommer sans casser les
formules).

| Table | Colonnes | Type |
|---|---|---|
| **LISTE_DES_ETUDIANTS** | NOM, PRENOM, FORMATION, Civilite, Centre_de_formation, Adresse_mail, Numero_de_telephone | Texte / Choix |
| | DDN | Date |
| | *Anonymat* (formule) | `PRENOM[0].upper() + DDN.strftime("%d%m%y") + NOM[0].upper()` |
| **PERIODES_DE_STAGE** | Etudiant, Anonymat | Référence → LISTE_DES_ETUDIANTS |
| | Service | Référence → SERVICES |
| | Du, Au | Date |
| | Tuteur, Code_anonymat | Texte |
| | Niveau | Choix (L1/L2/L3/M1/M2/Aide-Soignant) |
| | A_FAIRE | Numérique |
| | Evaluation_envoyee | Bool |
| | UUID | Texte (défaut `UUID()`) |
| | *En_cours* (formule) | `Au >= TODAY()` |
| | *FAIT* (formule) | somme des `Total_h_semaine` du planning |
| | *Solde_heures* (formule) | `FAIT - A_FAIRE` |
| | *Lien_evaluation* (formule) | URL du formulaire d'évaluation + `Cle_lien` |
| **PLANNING_HEBDO** | Periode | Référence → PERIODES_DE_STAGE |
| | Semaine_debut | Date |
| | Lundi…Dimanche (7 colonnes) | Référence → CODES_HORAIRES |
| | *Total_h_semaine* (formule) | somme des heures de la semaine |
| **CODES_HORAIRES** | Code, Libelle, Heure_debut, Heure_fin | Texte |
| | Compte_stage | Bool |
| | Ajustement_h | Numérique |
| | *Duree_heures* (formule) | calcul depuis Heure_debut/Heure_fin |
| **Sortie_de_stage** | Motif, Code_anonymat, Heure_debut, Heure_fin, Motif_ou_Commentaire | Texte |
| | Anonymat | Référence → LISTE_DES_ETUDIANTS |
| | Rapprochement_manuel | Référence → PERIODES_DE_STAGE |
| | Date | Date |
| | Compte_stage, Valide | Bool |
| | *Pour_le_stage_du_* (formule) | résout la période (via Rapprochement_manuel sinon par dates) |
| | *Duree_heures*, *Ajustement_h* (formules) | calcul des heures/impact sur le compteur |
| **SERVICES** | Nom, Code_UF | Texte |
| | Cadre_ref | Référence → UTILISATEURS |
| | Recoit_des_etudiant | Bool |
| **UTILISATEURS** | Nom, Prenom, Telephone, Code_acces | Texte |
| | Civilite | Choix |
| | *Email* (formule) | `prenom.nom@votredomaine` |
| **JOURS_FERIES** | Date | Date |
| | Libelle | Texte |
| **EVALUATION_STAGE_ETUDIANT** | Periode_de_stage | Référence → PERIODES_DE_STAGE |
| | Cle_lien | Texte |
| | Score_* / questions de satisfaction | Choix |
| | *Etudiant* (formule) | `Periode_de_stage_resolue.Etudiant` |
| | *Service* (formule) | `Periode_de_stage_resolue.Service` |
| | *Periode_de_stage_resolue* (formule) | `PERIODES_DE_STAGE.lookupOne(UUID=Cle_lien)` sinon `Periode_de_stage` |

D'autres tables existent dans le document d'origine (`Pole`, `SITES`,
`Localisation`, `RDV_FORMATEUR`, `TABLEAU_DE_BORD`, `BDD_COM`,
`COMPLEMENT_DOSSIER_ETUDIANT`, `PARAMETRES`…) : elles alimentent des widgets
Grist annexes (tableau de bord de satisfaction, rendez-vous formateur) mais
ne sont **pas requises** pour que l'espace étudiant/cadre fonctionne.

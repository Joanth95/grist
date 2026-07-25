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
     `Sortie_de_stage`, `EVALUATION_STAGE_ETUDIANT`, `JOURNAL_ACTIVITE`.
   - À adapter (ne pas vider, juste modifier le contenu) : `SERVICES`,
     `UTILISATEURS`, `CODES_HORAIRES`, `JOURS_FERIES`, `Pole`, `SITES`,
     `ETABLISSEMENT`.
   - ⚠️ `JOURNAL_ACTIVITE` est le journal de traçabilité (qui a consulté quoi,
     et quand) : recopié tel quel, il transporterait des données nominatives de
     l'établissement d'origine. Videz les lignes mais **gardez la table** : le
     worker y ajoute les colonnes manquantes tout seul, il ne sait pas créer la
     table.
   - Dans `UTILISATEURS`, videz aussi `PIN_hash`, `Reinit_PIN`, `PIN_essais` et
     `PIN_bloque_jusqu_a` si elles existent : sinon les cadres de la nouvelle
     installation héritent du PIN de l'ancienne.
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
    l'outil. C'est le 1ᵉʳ facteur, avec l'email.
  - `PIN_hash`, `Reinit_PIN`, `PIN_essais`, `PIN_bloque_jusqu_a` : **ne pas
    créer ni remplir à la main**, le worker les ajoute et les tient tout seul.
    2ᵉ facteur : le cadre choisit un PIN de 4 à 6 chiffres à sa première
    connexion (stocké haché, PBKDF2-SHA256). Cocher `Reinit_PIN` permet au
    cadre concerné d'en choisir un nouveau (et ferme ses sessions ouvertes) ;
    `PIN_essais`/`PIN_bloque_jusqu_a` bloquent le compte 15 minutes après
    5 PIN erronés — remettre `PIN_bloque_jusqu_a` à `0` débloque tout de suite.
- **`CODES_HORAIRES`** : gardez ou adaptez les codes (M, S, N, R, ABS, RF…),
  leurs horaires et si chacun compte comme temps de stage.
- **`JOURS_FERIES`** : liste des jours fériés à jour pour l'année en cours.
- **`ETABLISSEMENT`** (première ligne) : c'est le **panneau de configuration**
  du document. Toutes les URL y sont centralisées, les formules les lisent —
  il n'y a donc plus aucune adresse codée en dur dans les formules.
  - `Url_site` (Texte) : `https://votrecompte.github.io/nom-du-depot/`
    (avec le `/` final). Alimente tous les liens de connexion.
  - `Url_document_grist` (Texte) : l'URL du document, pour le lien
    « Administration (Grist) » du pied de page.
  - `Url_formulaire_evaluation` (Texte) : voir le point suivant.
  - `Signature_invitation` (Texte) : votre nom/fonction, signature du mail
    d'invitation des cadres.
  - Identité et habillage, tous facultatifs : `Nom`, `Description`,
    `Sous_titre`, `Logo` (pièce jointe) ; `DOMAINE_MAIL` (ex.
    `chu-exemple.fr` — complète les champs e-mail **professionnels**) ;
    `Texte_pied_de_page` ; `Afficher_bandeau_beta` (case, décochée = plus de
    bandeau « bêta ») ; `Mode_etablissement_public` (case, cochée ou absente =
    rendu DSFR des services publics, décochée = habillage « moderne »).
- **Évaluation de stage** : le formulaire appartient à chaque document.
  Recréez un **formulaire Grist** sur la table `EVALUATION_STAGE_ETUDIANT`
  (champ caché `Cle_lien` prérempli), publiez-le, et collez son URL dans
  `ETABLISSEMENT.Url_formulaire_evaluation` — la formule `Lien_evaluation`
  (sur `PERIODES_DE_STAGE`) la lit et y ajoute `?Cle_lien=<UUID>`. Colonne
  laissée vide : l'onglet « Envoi des évaluations » affiche « Lien non
  généré », le reste fonctionne.
- **Liens de connexion : le dièse, pas le point d'interrogation.** Les
  formules qui fabriquent des liens (`LISTE_DES_ETUDIANTS.Lien_connexion`,
  la colonne de lien de `UTILISATEURS`, `UTILISATEURS.Envoyer_l_invitation`)
  doivent écrire `index.html#code=…&email=…` et
  `espace-cadre.html#email=…&code=…`. Ce qui suit `#` n'est **jamais** envoyé
  au serveur : le code d'accès n'atterrit donc pas dans les journaux de
  l'hébergeur. Les liens en `?` fonctionnent encore, mais **régénérez-les**.
  Les formules complètes sont dans `docs/installation.html` (étape 5).

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

Puis les **secrets** — jamais dans `wrangler.toml`, qui est versionné :

```bash
npx wrangler secret put GRIST_API_KEY     # obligatoire : clé API Grist (étape 2)
npx wrangler secret put SESSION_SECRET    # recommandé : chaîne aléatoire longue
npx wrangler secret put ADMIN_KEY         # facultatif : clé de dépannage
npx wrangler deploy
```

- `SESSION_SECRET` signe les **jetons de session cadre** (HMAC-SHA256,
  valables 12 h, envoyés en en-tête `X-Cadre-Session`). Non défini, le worker
  dérive la clé de `GRIST_API_KEY` : tout marche, mais changer la clé API
  déconnecte alors tous les cadres. Générez-la avec
  `openssl rand -base64 32`.
- `ADMIN_KEY` est un **passe-partout** : ajoutée à un lien cadre
  (`espace-cadre.html#email=…&code=…&admin=…`), elle ouvre l'espace du cadre
  **sans son PIN** et n'est jamais bloquée par le compteur d'essais. Ne la
  définissez que si vous en avez besoin, et ne la diffusez pas.
- Pour les essais en local, ces valeurs vont dans `worker/.dev.vars` (déjà
  exclu du dépôt).

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

### Repointer les widgets Grist

Cinq vues du document sont des **widgets hébergés sur le site** : tant que
leur URL n'est pas changée, elles affichent les données de l'installation
d'origine (et écrivent dedans). Pour chacune : ouvrez la vue, panneau latéral
**Widget**, et remplacez l'URL par la vôtre.

| Vue | URL à mettre |
|---|---|
| Génération des semaines | `<votre-site>/generer-semaines.html` |
| Planning cadre | `<votre-site>/planning-cadre.html` |
| Planning de service | `<votre-site>/planning-serviceV2.html` |
| Planning de service (version historique) | `<votre-site>/planning-service.html` |
| Envoi des évaluations | `<votre-site>/envoyer-evaluation.html` |

---

## Étape 6 — Distribuer les accès

- **Étudiants** : aucun compte à créer, ils s'inscrivent eux-mêmes via
  `entree-stage.html` (code anonymat calculé automatiquement). L'**e-mail**
  saisi dans le dossier devient leur 2ᵉ facteur : la connexion demande le code
  anonymat *et* cet e-mail. Un dossier sans e-mail se connecte avec le code
  seul, mais l'e-mail ne peut plus y être ajouté depuis le site (c'est ce qui
  empêche un tiers de s'approprier un dossier).
- **Premier administrateur** : cochez `Administrateur` sur votre ligne de la
  table `UTILISATEURS` (la colonne est créée toute seule à la première
  connexion d'un cadre). Vous ouvrez alors `espace-admin.html`, d'où se créent
  les comptes suivants — codes d'accès compris — sans repasser par Grist.
- **Cadres** : transmettez à chacun son email professionnel + le
  `Code_acces` que vous avez saisi à l'étape 1 (ou généré depuis l'espace
  administrateur), avec l'URL
  `https://votrecompte.github.io/nom-du-depot/espace-cadre.html`. Précisez-lui
  qu'il **choisit lui-même son code PIN** (4 à 6 chiffres) au premier écran de
  connexion : ce PIN n'est pas à transmettre, et vous ne pourrez pas le lire.
- Si vous envoyez un **lien pré-rempli** (la formule `Envoyer_l_invitation` en
  fabrique un), écrivez-le avec un dièse — `espace-cadre.html#email=…&code=…` —
  et jamais avec `?` : voir l'étape 1. Le lien pré-remplit les champs, il ne
  connecte pas : le PIN est toujours demandé.

---

## Étape 7 — Vérifications

- [ ] `entree-stage.html` : auto-inscription d'un étudiant fictif, avec son
      e-mail.
- [ ] `docs/index.html` : connexion de cet étudiant avec son code anonymat
      **et** l'e-mail de son dossier.
- [ ] `espace-cadre.html` : connexion cadre (email + `Code_acces` + un PIN de
      4 à 6 chiffres qu'il choisit au premier écran), puis chaque onglet
      (Déclarations, Dossier, Planning, Évaluations) affiche les bonnes données
      du service.
- [ ] Après cette première connexion, `PIN_hash`, `Reinit_PIN`, `PIN_essais` et
      `PIN_bloque_jusqu_a` sont apparues toutes seules dans `UTILISATEURS`.
- [ ] Édition d'une case de planning, validation d'une déclaration : les
      changements apparaissent bien dans le document Grist, et une ligne
      s'ajoute dans `JOURNAL_ACTIVITE`.
- [ ] Une connexion volontairement ratée (PIN erroné) ajoute une ligne
      `Connexion refusée` dans `JOURNAL_ACTIVITE`, avec le motif et l'e-mail
      visé — et **sans** le PIN essayé.
- [ ] L'ouverture de `espace-admin.html` ajoute une ligne `Consultation de
      l'espace administrateur` sous le rôle `Administrateur`.
- [ ] Cocher `Reinit_PIN` ou décocher `Utilisateur_de_l_outil` coupe l'accès du
      cadre immédiatement, sans attendre l'expiration de sa session (12 h).
- [ ] Les widgets du document affichent bien les données de **votre** copie
      (étape 5).
- [ ] Un site **différent** du vôtre ne peut pas appeler votre worker
      (`ALLOWED_ORIGIN` correctement restreint).

Pendant ces essais, vous serez freiné — c'est normal : 5 PIN erronés bloquent
le compte 15 minutes (`PIN_bloque_jusqu_a` → `0` pour débloquer), et le worker
limite les appels par appareil (15 connexions/minute, 5 auto-inscriptions par
10 minutes, 5 nouvelles périodes par heure et par étudiant).

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
| | *En_cours* (formule) | `Du <= TODAY() and Au >= TODAY()` |
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
| | Site | Référence → SITES |
| | Recoit_des_etudiant | Bool |
| **UTILISATEURS** | Nom, Prenom, Telephone, Code_acces | Texte |
| | Civilite | Choix |
| | Utilisateur_de_l_outil | Bool (décoché = compte bloqué) |
| | Administrateur | Bool (coché = accès à l'espace administrateur du site) |
| | PIN_hash, Reinit_PIN, PIN_essais, PIN_bloque_jusqu_a | créées par le worker — ne pas les saisir |
| | *Email* (formule) | `prenom.nom@votredomaine` |
| **SITES** | NOM | Texte |
| **ETABLISSEMENT** | Nom, Description, Sous_titre | Texte |
| | Logo | Pièce jointe |
| | Url_site, Url_document_grist, Url_formulaire_evaluation, Signature_invitation | Texte |
| | DOMAINE_MAIL, Texte_pied_de_page | Texte (facultatif) |
| | Afficher_bandeau_beta, Mode_etablissement_public | Bool (facultatif) |
| **JOURNAL_ACTIVITE** | Horodatage | Date/heure (le worker écrit un timestamp Unix en secondes) |
| | Role, Qui, Nom, Action, Detail | Texte |
| | Site, Service, Etudiant | Texte (créées par le worker) |
| **RDV_FORMATEUR** | Periode | Référence → PERIODES_DE_STAGE |
| | Date_rdv | Date |
| | Type_de_rendez_vous | Choix |
| | Formateur, Commentaire, Cree_par | Texte |
| **JOURS_FERIES** | Date | Date |
| | Libelle | Texte |
| **EVALUATION_STAGE_ETUDIANT** | Periode_de_stage | Référence → PERIODES_DE_STAGE |
| | Cle_lien | Texte |
| | Score_* / questions de satisfaction | Choix |
| | *Etudiant* (formule) | `Periode_de_stage_resolue.Etudiant` |
| | *Service* (formule) | `Periode_de_stage_resolue.Service` |
| | *Periode_de_stage_resolue* (formule) | `PERIODES_DE_STAGE.lookupOne(UUID=Cle_lien)` sinon `Periode_de_stage` |

Trois tables sont lues systématiquement et **doivent exister**, même vides :
`SITES` (liste des services, page d'auto-inscription) et `RDV_FORMATEUR`
(chargement de l'espace cadre) — leur absence fait échouer ces écrans en
entier. `JOURNAL_ACTIVITE` doit exister pour la traçabilité : le worker crée
ses colonnes, pas la table. `ETABLISSEMENT`, en revanche, est tolérante :
absente ou vide, le site garde son affichage générique.

D'autres tables existent dans le document d'origine (`Pole`, `Localisation`,
`TABLEAU_DE_BORD`, `BDD_COM`, `COMPLEMENT_DOSSIER_ETUDIANT`, `PARAMETRES`…) :
elles alimentent des widgets Grist annexes (tableau de bord de satisfaction)
mais ne sont **pas requises** pour que l'espace étudiant/cadre fonctionne.

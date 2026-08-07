/**
 * © Joan Thuillier — Tous droits réservés. Voir LICENSE à la racine du dépôt.
 *
 * Proxy API entre l'espace étudiant (GitHub Pages) et le document Grist
 * GESTION-ETUDIANT (instance DINUM).
 *
 * La clé API Grist reste secrète ici (secret GRIST_API_KEY).
 * L'étudiant s'authentifie avec son code anonymat (1ère lettre du prénom
 * + date de naissance JJMMAA + 1ère lettre du nom, ex. J150398D).
 *
 * Règles métier :
 *   - Le planning hebdomadaire (PLANNING_HEBDO) est géré dans Grist :
 *     l'étudiant le CONSULTE uniquement.
 *   - L'étudiant déclare ses écarts dans Sortie_de_stage : rattrapage
 *     (heures en plus), retard (heures déduites par la formule Grist), etc.
 *   - Un étudiant peut s'inscrire seul (« entrée en stage ») : création de
 *     sa fiche LISTE_DES_ETUDIANTS + de sa période PERIODES_DE_STAGE.
 *
 * Endpoints (code anonymat dans l'en-tête X-Student-Code) :
 *   GET    /api/services                       -> services accueillant des étudiants (public)
 *   POST   /api/inscription    { ... }         -> auto-inscription (public)
 *   POST   /api/login          { code }        -> payload complet
 *   GET    /api/data[?vue=1]                   -> payload complet (rafraîchissement ;
 *                                                 ?vue=1 = ouverture de l'espace, journalisée)
 *   POST   /api/sorties        { ... }         -> nouvelle déclaration
 *   DELETE /api/sorties/:id                    -> suppression d'une de SES déclarations
 *   POST   /api/periodes       { Service, Niveau, Du, Au } -> nouvelle période de stage (même étudiant)
 *   PATCH  /api/profil  { Numero_de_telephone?, Adresse_mail? } -> modifie ses coordonnées
 *
 * Espace cadre : un cadre voit/modifie les services dont il est le cadre
 * principal (SERVICES.Cadre_ref), ceux où il figure en cadre secondaire
 * (SERVICES.Cadres_secondaires, liste de références) et, s'il est le CSS du pôle
 * (Pole.CSS, exposé par la formule SERVICES.Pole_CSS), tous les services du pôle.
 *
 * Authentification en deux temps :
 *   - la CONNEXION seule accepte email + code d'accès (UTILISATEURS.Code_acces)
 *     et exige le code PIN personnel ;
 *   - toutes les autres routes exigent le jeton de session délivré par la
 *     connexion (en-tête X-Cadre-Session). Le code d'accès seul n'ouvre donc
 *     plus aucune donnée : sans PIN valide, pas de jeton.
 *   POST   /api/cadre/login    { email, code, pin }    -> { session, ...payload des services }
 *   GET    /api/cadre/data                             -> payload complet (rafraîchissement)
 *   POST   /api/cadre/vue  { serviceId, onglet, etudiantId? } -> journalise ce qui est réellement
 *                                                                affiché (service, onglet, dossier)
 *   PATCH  /api/cadre/sorties/:id   { Valide }         -> valider/invalider une déclaration
 *   POST   /api/cadre/sorties  { periodeId, ... }      -> déclarer des heures pour un étudiant (en attente)
 *   PATCH  /api/cadre/planning/:semaineId { jour, codeId } -> édite une case du planning
 *   PATCH  /api/cadre/periodes/:id  { Tuteur, Niveau, Du, Au } -> édite une fiche de période
 *   DELETE /api/cadre/periodes/:id                     -> supprime une période déclarée par erreur
 *                                                         (+ semaines de planning et RDV rattachés)
 *   PATCH  /api/cadre/profil  { Telephone }                   -> modifie son propre numéro de téléphone
 *   PATCH  /api/cadre/services/:id  { codes: [ids] }          -> codes horaires actifs du service
 *                                                                (SERVICES.Codes_horaires ; vide = tous)
 *   POST   /api/cadre/codes  { Code, Libelle, ... }           -> crée un code horaire (pas de doublon,
 *                                                                pas de suppression possible)
 *   GET    /api/cadre/periodes/:id/planning-imprimable        -> HTML de la fiche de stage imprimable
 *                                                                (colonne formule PERIODES_DE_STAGE.Planning_HTML,
 *                                                                logo réaligné sur ETABLISSEMENT.Logo)
 *   POST   /api/cadre/periodes/:id/bilan  (multipart, champ "bilan") -> dépose le bilan final de ce
 *                                                                stage (PDF ou image), pour une période
 *                                                                de l'un de ses services
 *   GET    /api/cadre/periodes/:id/bilan                       -> télécharge le bilan
 *   DELETE /api/cadre/periodes/:id/bilan                       -> retire le bilan
 *   GET    /api/cadre/periodes/:id/commentaires                -> commentaires et pièces jointes
 *                                                                du stage (table BDD_COM)
 *   POST   /api/cadre/periodes/:id/commentaires  (multipart : "commentaire", "fichier")
 *                                                              -> ajoute un commentaire, avec
 *                                                                 pièce jointe facultative
 *   GET    /api/cadre/commentaires/:id/fichier                 -> télécharge sa pièce jointe
 *   DELETE /api/cadre/commentaires/:id                         -> supprime un commentaire
 *   POST   /api/cadre/rdv  { periodeId, Date_rdv, ... }        -> ajoute un rendez-vous formateur/tuteur
 *   DELETE /api/cadre/rdv/:id                                  -> supprime un rendez-vous formateur
 *
 * Espace administrateur : réservé aux cadres dont la case UTILISATEURS.
 * Administrateur est cochée. Même connexion que l'espace cadre (email + code
 * d'accès + PIN) et même jeton de session : le drapeau admin est scellé dans
 * l'empreinte du jeton, donc retirer la case coupe les sessions ouvertes.
 * Ces routes remplacent progressivement ce qui se faisait à la main dans Grist.
 *   GET    /api/admin/cadres[?vue=1&onglet=…]                  -> cadres, services et état des PIN
 *                                                                 (?vue=1 = ouverture de l'écran,
 *                                                                 journalisée avec l'onglet affiché ;
 *                                                                 sinon simple rafraîchissement)
 *   POST   /api/admin/cadres  { Nom, Prenom, ... }             -> crée un cadre (code d'accès généré)
 *   PATCH  /api/admin/cadres/:id  { ... }                      -> identité, activation, droits admin,
 *                                                                 services rattachés, et les actions
 *                                                                 réservées à l'admin : reinitPin,
 *                                                                 debloquerPin, regenererCode
 *   GET    /api/admin/organisation[?vue=1&onglet=…]            -> sites, pôles, services, codes
 *                                                                 horaires et cadres (?vue=1 : idem)
 *   POST   /api/admin/services  { Nom, Code_UF, SiteId, ... }  -> crée un service
 *   PATCH  /api/admin/services/:id  { ... }                    -> nom, code UF, site, pôle,
 *                                                                 référent, accueil des étudiants,
 *                                                                 codes horaires du service
 *   POST   /api/admin/sites  { NOM }                           -> crée un site
 *   POST   /api/admin/poles  { Nom, CSS: [ids] }               -> crée un pôle
 *   PATCH  /api/admin/poles/:id  { Nom?, CSS? }                -> renomme, change le cadre sup
 *   GET    /api/admin/etablissement[?vue=1&onglet=…]           -> paramètres généraux (identité,
 *                                                                 pied de page, domaine mail, habillage…)
 *   PATCH  /api/admin/etablissement  { nom?, description?, ... } -> modifie ces paramètres
 *                                                                 (table ETABLISSEMENT, 1 seule ligne)
 *   POST   /api/admin/etablissement/logo  (multipart, champ "logo") -> change le logo
 *   DELETE /api/admin/etablissement/logo                       -> retire le logo
 *   GET    /api/admin/etudiants[?vue=1&onglet=…]                -> un dossier par étudiant, résumé
 *   GET    /api/admin/etudiants/:id                             -> dossier complet (identité, stages,
 *                                                                  sorties, rdv, journal)
 *   PATCH  /api/admin/etudiants/:id  { NOM?, PRENOM?, DDN?, ... } -> modifie l'identité d'un étudiant
 *                                                                  (recalcule le code anonymat si
 *                                                                  nom/prénom/DDN changent)
 *   POST   /api/admin/etudiants/fusion  { garderId, fusionnerIds: [ids] } -> fusionne des dossiers
 *                                                                  en doublon dans le dossier conservé
 *   POST   /api/admin/etudiants/:id/periodes/:periodeId/bilan  (multipart, champ "bilan")
 *                                                              -> dépose le bilan final de ce stage
 *   GET    /api/admin/etudiants/:id/periodes/:periodeId/bilan  -> télécharge le bilan
 *   DELETE /api/admin/etudiants/:id/periodes/:periodeId/bilan  -> retire le bilan
 *
 * La table Pole n'a pas de schéma imposé (elle vient du document d'origine) :
 * ses colonnes — nom du pôle, cadre(s) supérieur(s), et la référence qui relie
 * un service à son pôle — sont DÉTECTÉES au vol (voir schemaOrganisation).
 * Aucune colonne n'est créée : si la table ou ses colonnes manquent, l'écran
 * le dit au lieu d'écrire n'importe où.
 */

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

const T_ETUDIANTS = "LISTE_DES_ETUDIANTS";
const T_PERIODES = "PERIODES_DE_STAGE";
const T_HEBDO = "PLANNING_HEBDO";
const T_CODES = "CODES_HORAIRES";
const T_SERVICES = "SERVICES";
const T_SITES = "SITES";
const T_SORTIES = "Sortie_de_stage";
const T_UTILISATEURS = "UTILISATEURS";
const T_FERIES = "JOURS_FERIES";
const T_EVALUATIONS = "EVALUATION_STAGE_ETUDIANT";
const T_RDV = "RDV_FORMATEUR";
// Commentaires + pièces jointes par période de stage (table déjà utilisée à la
// main dans Grist, avant le site : feuille de présence, bilan final...). Le
// bilan final s'y reconnaît par son Commentaire contenant "bilan" (insensible
// à la casse) — voir bilansDeLaPeriode.
const T_COMMENTAIRES = "BDD_COM";
const T_JOURNAL = "JOURNAL_ACTIVITE_V2";
const T_ETABLISSEMENT = "ETABLISSEMENT";
const T_POLE = "Pole";

const DAY_COLUMNS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

// Colonnes du questionnaire de satisfaction (EVALUATION_STAGE_ETUDIANT)
// remontées à l'espace cadre pour le dépouillement. Les libellés affichés sont
// côté front (SATISFACTION_THEMES dans espace-cadre.js) ; ici on ne fait que
// recopier les valeurs telles quelles.
const EVAL_COLONNES = [
  "accueil_premier_jour", "presentation_equipe_locaux", "clarte_infos_debut_stage",
  "disponibilite_encadrement", "qualite_transmissions_explications", "respect_rythme_progression",
  "frequence_bilans_retours", "securite_pour_questions",
  "diversite_situations", "adequation_activites_objectifs", "acces_protocoles_ressources",
  "organisation_generale_service", "ambiance_esprit_equipe", "charge_travail_percue",
  "sentiment_integration",
  "recommandation_stage", "points_forts", "axes_amelioration", "suggestions_equipe",
];

/** Lit un champ d'évaluation sans tenir compte de la casse de la colonne Grist
 *  (Note_globale, note_globale, NOTE_GLOBALE… selon la création de la table). */
function champEvaluation(fields, cle) {
  if (fields[cle] !== undefined) return fields[cle];
  const cible = cle.toLowerCase();
  for (const k of Object.keys(fields)) {
    if (k.toLowerCase() === cible) return fields[k];
  }
  return null;
}

const CIVILITES = ["Madame", "Monsieur"];
const FORMATIONS = ["AIDE SOIGNANT", "INFIRMIER", "AUTRE"];
const NIVEAUX = ["ESI L1", "ESI L2", "ESI L3", "M1", "M2", "Aide-Soignant"];
// Motifs proposés à l'étudiant ; « Retard » est déduit par la formule Grist
// Ajustement_h ; « Sortie de stage » compte ou non selon la case Compte_stage
const MOTIFS = ["Rattrapage", "Retard", "Sortie de stage"];

// Types de rendez-vous proposés au cadre (colonne Choice RDV_FORMATEUR.Type_de_rendez_vous).
// La colonne Grist reste un Choice libre : d'autres valeurs saisies dans Grist
// sont tolérées, ces valeurs ne sont que les propositions de l'espace cadre.
const RDV_TYPES = [
  "Mi-stage avec formateur",
  "Bilan final avec formateur",
  "Visite de stage formateur",
  "Entretien tuteur",
  "Point intermédiaire tuteur",
  "Autre",
];

// Nombre maximal de semaines générées automatiquement pour une période
const MAX_SEMAINES_GENEREES = 30;

// Base horaire réglementaire pour calculer les heures de stage à réaliser
const HEURES_PAR_SEMAINE = 35;

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(env, request);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    try {
      const response = await route(request, env, ctx);
      for (const [k, v] of Object.entries(cors)) response.headers.set(k, v);
      return response;
    } catch (err) {
      const status = err.status || 500;
      if (!err.status) console.error(err);
      return new Response(JSON.stringify({ error: err.publicMessage || "Erreur interne du serveur" }), {
        status,
        headers: {
          ...JSON_HEADERS, ...cors,
          ...(err.retryAfter ? { "Retry-After": String(err.retryAfter) } : {}),
        },
      });
    }
  },
};

function corsHeaders(env, request) {
  // ALLOWED_ORIGIN peut contenir plusieurs origines séparées par des virgules
  const allowed = (env.ALLOWED_ORIGIN || "*").split(",").map((o) => o.trim());
  const origin = request.headers.get("Origin");
  const allowOrigin = allowed.includes("*")
    ? "*"
    : allowed.includes(origin) ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Student-Code, X-Student-Email, X-Cadre-Session",
    "Access-Control-Max-Age": "86400",
  };
}

function httpError(status, publicMessage, retryAfter) {
  const err = new Error(publicMessage);
  err.status = status;
  err.publicMessage = publicMessage;
  if (retryAfter) err.retryAfter = retryAfter;
  return err;
}

/* ------------------------------------------------------------------ */
/* Limitation de débit                                                 */
/* ------------------------------------------------------------------ */

/*
 * Deux protections complémentaires contre les essais en série — aucun des trois
 * secrets n'est long : le code anonymat est court et prévisible, le code d'accès
 * cadre et le PIN ne font que 4 à 6 chiffres.
 *
 *  1. ce compteur en mémoire, immédiat et sans dépendance, mais propre à
 *     chaque isolat Cloudflare : il arrête un déluge sans rien garantir face
 *     à un attaquant qui répartit ses essais ;
 *  2. le verrouillage du PIN cadre, écrit dans Grist (voir verrouPin) : lui
 *     est global et persistant, et c'est la vraie barrière sur le PIN.
 *
 * Le code d'accès cadre n'a que la première : deviné, il ne donne toujours rien
 * sans le PIN, qui est le facteur verrouillé.
 */
const seaux = new Map();

/** Compte une tentative ; lève 429 au-delà de `max` dans la fenêtre donnée. */
function limiterDebit(cle, max, fenetreSecondes, message) {
  const maintenant = Date.now();
  // Ménage : sans lui la carte grandirait indéfiniment dans un isolat de longue vie.
  if (seaux.size > 5000) {
    for (const [k, s] of seaux) if (s.expire <= maintenant) seaux.delete(k);
  }
  const seau = seaux.get(cle);
  if (!seau || seau.expire <= maintenant) {
    seaux.set(cle, { expire: maintenant + fenetreSecondes * 1000, n: 1 });
    return;
  }
  seau.n++;
  if (seau.n > max) {
    const secondes = Math.max(1, Math.ceil((seau.expire - maintenant) / 1000));
    throw httpError(429, message || `Trop de tentatives : réessayez dans ${secondes} seconde(s).`, secondes);
  }
}

/** Identifie l'appelant : IP réelle fournie par Cloudflare, sinon repli global. */
function ipAppelant(request) {
  return request.headers.get("CF-Connecting-IP") || "inconnue";
}

/**
 * `?vue=1` : le front signale l'OUVERTURE d'un écran, à journaliser comme une
 * consultation. Sans ce marqueur, l'appel est un simple rafraîchissement qui
 * suit une action déjà tracée — le journaliser ferait une ligne en double.
 */
function estOuverture(request) {
  return new URL(request.url).searchParams.get("vue") === "1";
}

/** Onglet réellement affiché, signalé par le front avec ?onglet=… (le worker
 *  ne peut pas le deviner : plusieurs onglets partagent le même appel). */
function ongletVu(request) {
  const nom = cleanText(new URL(request.url).searchParams.get("onglet"), 60);
  return nom ? `onglet « ${nom} »` : "";
}

async function route(request, env, ctx) {
  const path = new URL(request.url).pathname.replace(/\/+$/, "");

  // --- Endpoints publics (page d'entrée en stage) ---
  if (request.method === "GET" && path === "/api/config") {
    return getConfigEtablissement(env);
  }
  if (request.method === "GET" && path === "/api/config/logo") {
    return getLogoEtablissement(env);
  }
  if (request.method === "GET" && path === "/api/services") {
    return listServices(env);
  }
  if (request.method === "POST" && path === "/api/inscription") {
    // Endpoint public qui crée un dossier, une période et jusqu'à 30 semaines
    // de planning : sans frein, il remplirait la base en quelques minutes.
    limiterDebit(`inscription:${ipAppelant(request)}`, 5, 600,
      "Trop d'inscriptions envoyées depuis cet appareil : patientez quelques minutes.");
    return inscription(request, env, ctx);
  }
  if (request.method === "POST" && path === "/api/login") {
    const body = await request.json().catch(() => ({}));
    const ip = ipAppelant(request);
    limiterDebit(`login:${ip}`, 15, 60);
    // Second seau par code visé : empêche de balayer les codes possibles depuis
    // plusieurs appareils, et de s'acharner sur un dossier précis.
    limiterDebit(`login:code:${normalizeCode(body.code) || ip}`, 8, 60);
    const student = await authenticateCode(env, body.code, body.email).catch((err) => {
      // Le refus est journalisé au même titre que la connexion : sinon un essai
      // en série sur un dossier ne laisserait aucune trace. Le message
      // d'authentification est volontairement unique (voir authenticateCode) :
      // le journal ne dit donc pas non plus si le code existe.
      if (err && err.status === 401) {
        logRefusConnexion(env, ctx, {
          role: "Étudiant", qui: normalizeCode(body.code) || body.code, ip,
          motif: "code anonymat ou adresse e-mail incorrect",
        });
      }
      throw err;
    });
    const payload = await buildPayload(env, student);
    logActivite(env, ctx, {
      role: "Étudiant",
      qui: student.code,
      nom: nomCompletEtudiant(student),
      action: "Connexion",
      ...contexteStageEtudiant(payload),
    });
    purgeJournal(env, ctx);
    purgePlanningsOrphelins(env, ctx);
    return json(payload);
  }
  if (request.method === "POST" && path === "/api/cadre/login") {
    const body = await request.json().catch(() => ({}));
    const ipCadre = ipAppelant(request);
    limiterDebit(`cadre:${ipCadre}`, 15, 60);
    limiterDebit(`cadre:compte:${String(body.email || "").trim().toLowerCase() || ipCadre}`, 10, 60);
    const emailEssaye = String(body.email || "").trim().toLowerCase();
    const cadre = await authenticateCadre(env, body.email, body.code).catch((err) => {
      // 401 : e-mail inconnu ou code d'accès faux ; 403 : compte désactivé.
      // Les deux valent d'être tracés — le second signale un ancien cadre qui
      // tente encore d'entrer avec un code qu'il a gardé.
      const st = err && err.status;
      if (st === 401 || st === 403) {
        logRefusConnexion(env, ctx, {
          role: "Cadre", qui: emailEssaye, ip: ipCadre,
          motif: st === 403 ? "compte désactivé" : "e-mail ou code d'accès incorrect",
        });
      }
      throw err;
    });

    // Accès administrateur : une clé secrète forte (env.ADMIN_KEY) permet de se
    // connecter à l'espace d'un cadre SANS son PIN (support / impersonation).
    // Elle n'est jamais dans le mail d'invitation ; uniquement dans le lien
    // admin (colonne Grist réservée). Le compte doit rester actif (vérifié plus haut).
    const accesAdmin = isAdminKey(env, body.adminKey);

    if (!accesAdmin) {
      // Code PIN auto-choisi : créé à la 1ʳᵉ connexion, redemandé ensuite.
      // Colonnes gérées dans UTILISATEURS : PIN_hash (le PIN haché) et
      // Reinit_PIN (case que l'admin coche dans Grist pour forcer un nouveau PIN).
      await ensureColumns(env, T_UTILISATEURS, [
        { id: "PIN_hash", label: "PIN (haché)", type: "Text" },
        { id: "Reinit_PIN", label: "Réinitialiser le PIN", type: "Bool" },
        { id: "PIN_essais", label: "PIN — essais manqués", type: "Int" },
        { id: "PIN_bloque_jusqu_a", label: "PIN — bloqué jusqu'à", type: "Int" },
        { id: "Administrateur", label: "Administrateur", type: "Bool" },
      ]);
      try {
        verifierVerrouPin(cadre);
      } catch (err) {
        logRefusConnexion(env, ctx, {
          role: "Cadre", qui: emailEssaye, nom: cadreNomComplet(cadre), ip: ipCadre,
          motif: "compte bloqué après plusieurs codes PIN erronés",
        });
        throw err;
      }
      const pin = typeof body.pin === "string" ? body.pin.trim() : "";
      const storedPin = (cadre.fields.PIN_hash || "").trim();
      const resetDemande = cadre.fields.Reinit_PIN === true;
      if (!storedPin || resetDemande) {
        // 1ʳᵉ connexion OU réinitialisation demandée : le PIN saisi devient le nouveau.
        if (!/^\d{4,6}$/.test(pin)) {
          throw httpError(400, storedPin
            ? "Votre PIN a été réinitialisé : choisissez un nouveau code PIN de 4 à 6 chiffres"
            : "Première connexion : choisissez un code PIN de 4 à 6 chiffres");
        }
        const fields = { PIN_hash: await hashPin(pin) };
        if (resetDemande) fields.Reinit_PIN = false; // consomme la demande de reset
        await gristUpdate(env, T_UTILISATEURS, cadre.rowId, fields);
        // Le jeton scelle l'empreinte des secrets du compte : elle doit refléter
        // ce qui vient d'être écrit, sinon la session serait rejetée d'emblée.
        Object.assign(cadre.fields, fields);
      } else {
        if (!pin) throw httpError(401, "Code PIN requis");
        if (!(await verifyPin(pin, storedPin))) {
          // Journalisé AVANT noterEchecPin, qui lève lui-même 429 dès que le
          // seuil de blocage est atteint : sinon le dernier essai — celui qui
          // verrouille le compte — passerait à la trappe.
          logRefusConnexion(env, ctx, {
            role: "Cadre", qui: emailEssaye, nom: cadreNomComplet(cadre), ip: ipCadre,
            motif: "code PIN incorrect",
          });
          await noterEchecPin(env, cadre);
          throw httpError(401, "Code PIN incorrect");
        }
        await reinitialiserVerrouPin(env, cadre);
      }
    }

    const payload = await buildCadrePayload(env, cadre);
    payload.session = await creerSessionCadre(env, cadre);
    logActivite(env, ctx, {
      role: "Cadre",
      qui: (cadre.fields.Email || "").trim(),
      nom: cadreNomComplet(cadre),
      action: "Connexion",
      detail: `${cadre.services.length} service(s) accessible(s)`
        + (accesAdmin ? " — accès administrateur (sans PIN)" : ""),
    });
    purgeJournal(env, ctx);
    purgePlanningsOrphelins(env, ctx);
    return json(payload);
  }
  // --- Endpoints cadre authentifiés ---
  if (path.startsWith("/api/cadre/")) {
    // Jeton de session uniquement : le code d'accès seul n'ouvre rien ici.
    const cadre = await authenticateCadreSession(env, request.headers.get("X-Cadre-Session"));
    const who = {
      role: "Cadre",
      qui: (cadre.fields.Email || "").trim(),
      nom: cadreNomComplet(cadre),
    };
    if (request.method === "GET" && path === "/api/cadre/data") {
      // Pas de journalisation ici : ce point d'entrée sert aussi de simple
      // rafraîchissement après chaque action (l'action, elle, est déjà tracée).
      // La consultation est signalée par le front via /api/cadre/vue, qui sait
      // quel service et quel onglet sont réellement affichés.
      return json(await buildCadrePayload(env, cadre));
    }
    if (request.method === "POST" && path === "/api/cadre/vue") {
      const body = await request.json().catch(() => ({}));
      const serviceId = Number(body.serviceId);
      const etudiantId = await etudiantDuCadre(env, cadre, body.etudiantId);
      logActivite(env, ctx, {
        ...who,
        action: etudiantId ? "Consultation d'un dossier étudiant" : "Consultation de l'espace cadre",
        serviceId: cadre.serviceIds.has(serviceId) ? serviceId : undefined,
        etudiantId,
        detail: body.onglet ? `onglet « ${cleanText(body.onglet, 60)} »` : "",
      });
      return json({ ok: true });
    }
    const sm = path.match(/^\/api\/cadre\/sorties\/(\d+)$/);
    if (request.method === "PATCH" && sm) {
      return withLog(env, ctx, who, "Validation / modif déclaration", `déclaration #${sm[1]}`,
        (info) => validerSortie(request, env, cadre, Number(sm[1]), info));
    }
    if (request.method === "POST" && path === "/api/cadre/sorties") {
      return withLog(env, ctx, who, "Déclaration créée pour un étudiant", "",
        (info) => creerSortiePourEtudiant(request, env, cadre, info));
    }
    if (request.method === "POST" && path === "/api/cadre/inscription") {
      return withLog(env, ctx, who, "Inscription / ajout de stage", "",
        (info) => inscriptionParCadre(request, env, cadre, info));
    }
    if (request.method === "GET" && path === "/api/cadre/etudiants/recherche") {
      return withLog(env, ctx, who, "Recherche d'un étudiant", "",
        (info) => rechercherEtudiants(request, env, cadre, info));
    }
    const wm = path.match(/^\/api\/cadre\/planning\/(\d+)$/);
    if (request.method === "PATCH" && wm) {
      return withLog(env, ctx, who, "Modification du planning", `semaine #${wm[1]}`,
        (info) => updatePlanningJour(request, env, cadre, Number(wm[1]), info));
    }
    const pm = path.match(/^\/api\/cadre\/periodes\/(\d+)$/);
    if (request.method === "PATCH" && pm) {
      return withLog(env, ctx, who, "Modification fiche période", `période #${pm[1]}`,
        (info) => updatePeriode(request, env, cadre, Number(pm[1]), info));
    }
    if (request.method === "DELETE" && pm) {
      return withLog(env, ctx, who, "Suppression d'une période de stage", `période #${pm[1]}`,
        (info) => supprimerPeriode(env, ctx, cadre, Number(pm[1]), info));
    }
    const im = path.match(/^\/api\/cadre\/periodes\/(\d+)\/planning-imprimable$/);
    if (request.method === "GET" && im) {
      return withLog(env, ctx, who, "Impression de la fiche de stage", `période #${im[1]}`,
        (info) => planningImprimable(request, env, cadre, Number(im[1]), info));
    }
    const cbm = path.match(/^\/api\/cadre\/periodes\/(\d+)\/bilan$/);
    if (cbm) {
      const periodeId = Number(cbm[1]);
      if (request.method === "POST") {
        return withLog(env, ctx, who, "Dépôt du bilan final de stage", `période #${periodeId}`,
          async (info) => deposerBilan(request, env, await ensurePeriodeInScope(env, cadre, periodeId), info));
      }
      if (request.method === "DELETE") {
        return withLog(env, ctx, who, "Suppression du bilan final de stage", `période #${periodeId}`,
          async (info) => retirerBilan(env, await ensurePeriodeInScope(env, cadre, periodeId), info));
      }
      if (request.method === "GET") {
        return telechargerBilan(env, await ensurePeriodeInScope(env, cadre, periodeId));
      }
    }
    const ccm = path.match(/^\/api\/cadre\/periodes\/(\d+)\/commentaires$/);
    if (ccm) {
      const periodeId = Number(ccm[1]);
      if (request.method === "GET") {
        return listerCommentaires(env, await ensurePeriodeInScope(env, cadre, periodeId));
      }
      if (request.method === "POST") {
        return withLog(env, ctx, who, "Ajout d'un commentaire de stage", "",
          async (info) => ajouterCommentaire(request, env, await ensurePeriodeInScope(env, cadre, periodeId), info));
      }
    }
    const cfm = path.match(/^\/api\/cadre\/commentaires\/(\d+)\/fichier$/);
    if (request.method === "GET" && cfm) {
      return telechargerFichierCommentaire(env, await commentaireDuCadre(env, cadre, Number(cfm[1])));
    }
    const cdm = path.match(/^\/api\/cadre\/commentaires\/(\d+)$/);
    if (request.method === "DELETE" && cdm) {
      return withLog(env, ctx, who, "Suppression d'un commentaire de stage", "",
        async (info) => supprimerCommentaire(env, await commentaireDuCadre(env, cadre, Number(cdm[1])), info));
    }
    if (request.method === "POST" && path === "/api/cadre/rdv") {
      return withLog(env, ctx, who, "Ajout d'un RDV formateur", "",
        (info) => creerRdv(request, env, cadre, info));
    }
    const rm = path.match(/^\/api\/cadre\/rdv\/(\d+)$/);
    if (request.method === "DELETE" && rm) {
      return withLog(env, ctx, who, "Suppression d'un RDV formateur", `rdv #${rm[1]}`,
        (info) => supprimerRdv(env, cadre, Number(rm[1]), info));
    }
    if (request.method === "PATCH" && path === "/api/cadre/profil") {
      return withLog(env, ctx, who, "Modification de son profil", "",
        (info) => updateProfilCadre(request, env, cadre, info));
    }
    if (request.method === "PATCH" && path === "/api/cadre/pin") {
      return withLog(env, ctx, who, "Modification du code PIN", "",
        (info) => changePin(request, env, cadre, info));
    }
    const svm = path.match(/^\/api\/cadre\/services\/(\d+)$/);
    if (request.method === "PATCH" && svm) {
      return withLog(env, ctx, who, "Modification des codes horaires du service", `service #${svm[1]}`,
        (info) => updateCodesService(request, env, cadre, Number(svm[1]), info));
    }
    const mbm = path.match(/^\/api\/cadre\/services\/(\d+)\/mail-bienvenue$/);
    if (request.method === "PATCH" && mbm) {
      return withLog(env, ctx, who, "Modification du mail de bienvenue", `service #${mbm[1]}`,
        (info) => updateMailBienvenue(request, env, cadre, Number(mbm[1]), info));
    }
    if (request.method === "POST" && path === "/api/cadre/codes") {
      return withLog(env, ctx, who, "Création d'un code horaire", "",
        (info) => creerCodeHoraire(request, env, cadre, info));
    }
    throw httpError(404, "Route inconnue");
  }

  // --- Endpoints administrateur (UTILISATEURS.Administrateur coché) ---
  if (path.startsWith("/api/admin/")) {
    const admin = await authenticateCadreSession(env, request.headers.get("X-Cadre-Session"));
    if (!admin.estAdmin) {
      throw httpError(403, "Réservé aux administrateurs de l'application");
    }
    const whoA = {
      role: "Administrateur",
      qui: (admin.fields.Email || "").trim(),
      nom: cadreNomComplet(admin),
    };
    if (request.method === "GET" && path === "/api/admin/cadres") {
      // L'espace admin est l'écran le plus sensible du site (tous les comptes,
      // leurs droits, l'état de leurs PIN) : son ouverture est journalisée,
      // comme l'est celle de l'espace cadre.
      if (estOuverture(request)) {
        logActivite(env, ctx, { ...whoA, action: "Consultation de l'espace administrateur",
          detail: ongletVu(request) || "onglet « Cadres »" });
      }
      return json(await listerCadresAdmin(env, admin));
    }
    if (request.method === "POST" && path === "/api/admin/cadres") {
      return withLog(env, ctx, whoA, "Création d'un compte cadre", "",
        (info) => creerCadreAdmin(request, env, info));
    }
    const acm = path.match(/^\/api\/admin\/cadres\/(\d+)$/);
    if (request.method === "PATCH" && acm) {
      return withLog(env, ctx, whoA, "Modification d'un compte cadre", "",
        (info) => modifierCadreAdmin(request, env, admin, Number(acm[1]), info));
    }
    if (request.method === "GET" && path === "/api/admin/organisation") {
      if (estOuverture(request)) {
        logActivite(env, ctx, { ...whoA, action: "Consultation de l'espace administrateur",
          detail: ongletVu(request) || "onglet « Services »" });
      }
      return json(await listerOrganisationAdmin(env));
    }
    if (request.method === "GET" && path === "/api/admin/etablissement") {
      if (estOuverture(request)) {
        logActivite(env, ctx, { ...whoA, action: "Consultation de l'espace administrateur",
          detail: ongletVu(request) || "onglet « Établissement »" });
      }
      return json(await listerEtablissementAdmin(env));
    }
    if (request.method === "PATCH" && path === "/api/admin/etablissement") {
      return withLog(env, ctx, whoA, "Modification des paramètres de l'établissement", "",
        (info) => modifierEtablissementAdmin(request, env, info));
    }
    if (request.method === "POST" && path === "/api/admin/etablissement/logo") {
      return withLog(env, ctx, whoA, "Changement du logo de l'établissement", "",
        (info) => televerserLogoEtablissement(request, env, info));
    }
    if (request.method === "DELETE" && path === "/api/admin/etablissement/logo") {
      return withLog(env, ctx, whoA, "Suppression du logo de l'établissement", "",
        (info) => supprimerLogoEtablissement(env, info));
    }
    if (request.method === "GET" && path === "/api/admin/etudiants") {
      if (estOuverture(request)) {
        logActivite(env, ctx, { ...whoA, action: "Consultation de l'espace administrateur",
          detail: ongletVu(request) || "onglet « Étudiants »" });
      }
      return json(await listerEtudiantsAdmin(env));
    }
    const aem = path.match(/^\/api\/admin\/etudiants\/(\d+)$/);
    if (request.method === "GET" && aem) {
      // Contrairement aux listes d'ensemble (gardées par estOuverture), chaque
      // ouverture d'un dossier précis est journalisée : c'est la consultation
      // la plus sensible de l'espace admin (tout l'historique d'un étudiant).
      const fiche = await ficheEtudiantAdmin(env, Number(aem[1]));
      logActivite(env, ctx, { ...whoA, action: "Consultation d'un dossier étudiant (admin)",
        etudiantId: Number(aem[1]) });
      return json(fiche);
    }
    if (request.method === "PATCH" && aem) {
      return withLog(env, ctx, whoA, "Modification d'un dossier étudiant (admin)", "",
        (info) => modifierEtudiantAdmin(request, env, Number(aem[1]), info));
    }
    if (request.method === "POST" && path === "/api/admin/etudiants/fusion") {
      return withLog(env, ctx, whoA, "Fusion de dossiers étudiants", "",
        (info) => fusionnerEtudiantsAdmin(request, env, info));
    }
    const abm = path.match(/^\/api\/admin\/etudiants\/(\d+)\/periodes\/(\d+)\/bilan$/);
    if (abm) {
      const etuId = Number(abm[1]);
      const periodeId = Number(abm[2]);
      if (request.method === "POST") {
        return withLog(env, ctx, whoA, "Dépôt du bilan final de stage", "",
          async (info) => deposerBilan(request, env, await periodeDeLEtudiant(env, etuId, periodeId), info));
      }
      if (request.method === "DELETE") {
        return withLog(env, ctx, whoA, "Suppression du bilan final de stage", "",
          async (info) => retirerBilan(env, await periodeDeLEtudiant(env, etuId, periodeId), info));
      }
      if (request.method === "GET") {
        return telechargerBilan(env, await periodeDeLEtudiant(env, etuId, periodeId));
      }
    }
    if (request.method === "POST" && path === "/api/admin/services") {
      return withLog(env, ctx, whoA, "Création d'un service", "",
        (info) => creerServiceAdmin(request, env, info));
    }
    const asm = path.match(/^\/api\/admin\/services\/(\d+)$/);
    if (request.method === "PATCH" && asm) {
      return withLog(env, ctx, whoA, "Modification d'un service", "",
        (info) => modifierServiceAdmin(request, env, Number(asm[1]), info));
    }
    if (request.method === "POST" && path === "/api/admin/sites") {
      return withLog(env, ctx, whoA, "Création d'un site", "",
        (info) => creerSiteAdmin(request, env, info));
    }
    if (request.method === "POST" && path === "/api/admin/poles") {
      return withLog(env, ctx, whoA, "Création d'un pôle", "",
        (info) => creerPoleAdmin(request, env, info));
    }
    const apm = path.match(/^\/api\/admin\/poles\/(\d+)$/);
    if (request.method === "PATCH" && apm) {
      return withLog(env, ctx, whoA, "Modification d'un pôle", "",
        (info) => modifierPoleAdmin(request, env, Number(apm[1]), info));
    }
    throw httpError(404, "Route inconnue");
  }

  // --- Endpoints authentifiés ---
  const student = await authenticateCode(
    env,
    request.headers.get("X-Student-Code"),
    request.headers.get("X-Student-Email")
  );

  const whoE = { role: "Étudiant", qui: student.code, nom: nomCompletEtudiant(student) };
  if (request.method === "GET" && path === "/api/data") {
    const data = await buildPayload(env, student);
    if (estOuverture(request)) {
      logActivite(env, ctx, { ...whoE, action: "Consultation de son espace", ...contexteStageEtudiant(data) });
    }
    return json(data);
  }
  if (request.method === "POST" && path === "/api/sorties") {
    return withLog(env, ctx, whoE, "Déclaration créée", "",
      (info) => createSortie(request, env, student, info));
  }
  const m = path.match(/^\/api\/sorties\/(\d+)$/);
  if (request.method === "DELETE" && m) {
    return withLog(env, ctx, whoE, "Déclaration supprimée", `déclaration #${m[1]}`,
      (info) => deleteSortie(env, student, Number(m[1]), info));
  }
  if (request.method === "POST" && path === "/api/periodes") {
    // Chaque période crée jusqu'à 30 semaines de planning : on borne la casse
    // qu'un compte compromis (ou un script en boucle) pourrait faire.
    limiterDebit(`periode:${student.code}`, 5, 3600,
      "Vous avez enregistré plusieurs stages coup sur coup : patientez avant d'en ajouter un autre.");
    return withLog(env, ctx, whoE, "Nouvelle période de stage", "",
      (info) => creerPeriodeEtudiant(request, env, student, info));
  }
  if (request.method === "PATCH" && path === "/api/profil") {
    return withLog(env, ctx, whoE, "Modification de son profil", "",
      (info) => updateProfilEtudiant(request, env, student, info));
  }

  throw httpError(404, "Route inconnue");
}

/* ------------------------------------------------------------------ */
/* Authentification                                                    */
/* ------------------------------------------------------------------ */

function normalizeCode(code) {
  if (typeof code !== "string") return null;
  code = code.trim().toUpperCase();
  // 1 lettre (accents acceptés) + JJMMAA + 1 lettre
  if (!/^\p{Lu}\d{6}\p{Lu}$/u.test(code)) return null;
  return code;
}

async function authenticateCode(env, rawCode, rawEmail) {
  // Message unique pour tous les échecs : un message différent selon que le
  // code existe, qu'il lui manque l'e-mail ou que l'e-mail est faux permettrait
  // de reconnaître les codes valides en les essayant un par un.
  const invalide = () => httpError(401, "Code anonymat ou adresse e-mail incorrect");

  const code = normalizeCode(rawCode);
  if (!code) throw invalide();
  let records = await gristFilter(env, T_ETUDIANTS, { Anonymat: [code] });
  if (!records.length) throw invalide();
  if (records.length > 1) {
    // Deux dossiers peuvent partager un code (homonymes nés le même jour) :
    // l'e-mail les départage, faute de quoi les deux étudiants se retrouvaient
    // bloqués. S'il ne tranche pas, l'administrateur doit corriger les dossiers.
    const fourni = (typeof rawEmail === "string" ? rawEmail : "").trim().toLowerCase();
    records = fourni
      ? records.filter((r) => (r.fields.Adresse_mail || "").trim().toLowerCase() === fourni)
      : [];
    if (records.length !== 1) {
      console.error(`Code anonymat ${code} partagé par plusieurs dossiers : connexion impossible`);
      throw invalide();
    }
  }
  // `deuxiemeFacteur` : vrai seulement si l'e-mail du dossier a été prouvé.
  const student = { rowId: records[0].id, code, fields: records[0].fields, deuxiemeFacteur: false };

  // 2ᵉ facteur : l'e-mail du dossier. Vérifié seulement si un e-mail y figure
  // (les dossiers sans e-mail restent accessibles au seul code, pas de blocage).
  const dossierEmail = (student.fields.Adresse_mail || "").trim().toLowerCase();
  if (dossierEmail) {
    const provided = (typeof rawEmail === "string" ? rawEmail : "").trim().toLowerCase();
    if (!provided || provided !== dossierEmail) throw invalide();
    student.deuxiemeFacteur = true;
  }
  return student;
}

/* ------------------------------------------------------------------ */
/* Hachage du code PIN cadre (PBKDF2-HMAC-SHA256, sel aléatoire)        */
/* ------------------------------------------------------------------ */

// Itérations PBKDF2. Volontairement modéré : le hash n'est jamais exposé
// (il vit dans Grist, accès contrôlé) et le PIN est un facteur secondaire ;
// la vraie défense contre le brute-force en ligne est la limitation de débit.
// Calibré pour rester sous le budget CPU d'une requête Worker (~10 ms/plan
// gratuit). verifyPin lit le nombre d'itérations dans le hash stocké : cette
// valeur peut donc être augmentée plus tard sans invalider les PIN existants.
const PIN_ITERATIONS = 10000;

function bytesToB64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function b64ToBytes(b64) {
  const s = atob(b64);
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a;
}

async function derivePin(pin, salt, iterations) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256);
  return new Uint8Array(bits);
}

/** Renvoie une chaîne stockable : "pbkdf2$<iter>$<selB64>$<hashB64>". */
async function hashPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const h = await derivePin(pin, salt, PIN_ITERATIONS);
  return `pbkdf2$${PIN_ITERATIONS}$${bytesToB64(salt)}$${bytesToB64(h)}`;
}

/** Compare un PIN saisi au hash stocké (temps constant). */
async function verifyPin(pin, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = parseInt(parts[1], 10);
  if (!Number.isInteger(iterations) || iterations < 1) return false;
  const salt = b64ToBytes(parts[2]);
  const expected = b64ToBytes(parts[3]);
  const got = await derivePin(pin, salt, iterations);
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ expected[i];
  return diff === 0;
}

/* ------------------------------------------------------------------ */
/* Verrouillage du PIN après essais infructueux                        */
/* ------------------------------------------------------------------ */

// Un PIN de 4 chiffres, c'est 10 000 possibilités : sans verrou, elles se
// parcourent. Le compteur vit dans Grist (colonnes PIN_essais et
// PIN_bloque_jusqu_a, créées automatiquement), donc il est commun à tous les
// isolats Cloudflare et survit aux redémarrages — contrairement au limiteur en
// mémoire, qu'un attaquant réparti contournerait.
// À savoir : quelqu'un qui connaît l'e-mail ET le code d'accès d'un cadre peut
// ainsi le bloquer 15 minutes en saisissant de faux PIN. C'est le prix de la
// protection ; la clé administrateur, elle, n'est jamais bloquée et permet de
// dépanner immédiatement.
const PIN_ESSAIS_MAX = 5;
const PIN_BLOCAGE_SECONDES = 15 * 60;

/** Lève 429 tant que le compte est sous verrou. */
function verifierVerrouPin(cadre) {
  const reste = (Number(cadre.fields.PIN_bloque_jusqu_a) || 0) - Math.floor(Date.now() / 1000);
  if (reste > 0) {
    throw httpError(429, `Trop de codes PIN erronés : ce compte est bloqué pendant encore `
      + `${Math.ceil(reste / 60)} minute(s). En cas d'urgence, contactez l'administrateur.`, reste);
  }
}

/** Enregistre un PIN erroné et verrouille le compte au-delà du seuil. */
async function noterEchecPin(env, cadre) {
  const essais = (Number(cadre.fields.PIN_essais) || 0) + 1;
  const fields = essais >= PIN_ESSAIS_MAX
    ? { PIN_essais: 0, PIN_bloque_jusqu_a: Math.floor(Date.now() / 1000) + PIN_BLOCAGE_SECONDES }
    : { PIN_essais: essais };
  // Best-effort : si Grist refuse l'écriture, on ne transforme pas une panne de
  // journalisation en refus de connexion (le limiteur en mémoire reste actif).
  await gristUpdate(env, T_UTILISATEURS, cadre.rowId, fields).catch(() => {});
  Object.assign(cadre.fields, fields);
  verifierVerrouPin(cadre); // annonce le blocage dès l'essai qui le déclenche
}

/** Remet les compteurs à zéro après une connexion réussie. */
async function reinitialiserVerrouPin(env, cadre) {
  if (!cadre.fields.PIN_essais && !cadre.fields.PIN_bloque_jusqu_a) return;
  const fields = { PIN_essais: 0, PIN_bloque_jusqu_a: 0 };
  await gristUpdate(env, T_UTILISATEURS, cadre.rowId, fields).catch(() => {});
  Object.assign(cadre.fields, fields);
}

/* ------------------------------------------------------------------ */
/* Session cadre : jeton signé (HMAC-SHA256), délivré par la connexion  */
/* ------------------------------------------------------------------ */

// Durée de vie d'une session cadre. Le jeton vit dans le sessionStorage du
// navigateur (donc au plus le temps de l'onglet) ; cette borne serveur limite
// en plus la fenêtre d'utilisation d'un jeton qui aurait fuité.
const SESSION_TTL_SECONDES = 12 * 3600;

// Clé de signature. SESSION_SECRET si l'installation en définit un (recommandé :
// npx wrangler secret put SESSION_SECRET) ; à défaut, dérivée de la clé API
// Grist, qui est déjà un secret du Worker — ainsi la protection fonctionne sans
// configuration supplémentaire. Conséquence à connaître : changer le secret
// utilisé invalide toutes les sessions en cours (les cadres se reconnectent).
async function sessionKey(env) {
  const secret = (env.SESSION_SECRET || env.GRIST_API_KEY || "").trim();
  if (!secret) throw httpError(500, "Configuration du serveur incomplète");
  return crypto.subtle.importKey(
    "raw", new TextEncoder().encode("espace-cadre-session|" + secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

function b64urlDepuisBytes(bytes) {
  return bytesToB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDepuisTexte(texte) {
  return b64urlDepuisBytes(new TextEncoder().encode(texte));
}
function texteDepuisB64url(s) {
  const b64 = String(s).replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return new TextDecoder().decode(b64ToBytes(pad));
}

async function signer(env, donnees) {
  const key = await sessionKey(env);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(donnees));
  return b64urlDepuisBytes(new Uint8Array(sig));
}

/**
 * Empreinte des secrets et des droits du compte (code d'accès, PIN, drapeau
 * administrateur). Elle est enfermée dans le jeton : changer le code d'accès,
 * changer le PIN, cocher « Réinitialiser le PIN » ou retirer les droits
 * d'administration coupe immédiatement les sessions ouvertes.
 */
async function empreinteCadre(fields) {
  const base = [(fields.Code_acces || "").trim(), (fields.PIN_hash || "").trim(),
    fields.Reinit_PIN === true ? "1" : "0",
    fields.Administrateur === true ? "1" : "0"].join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(base));
  return b64urlDepuisBytes(new Uint8Array(digest)).slice(0, 22);
}

/** Jeton de session : "<payload b64url>.<signature b64url>". */
async function creerSessionCadre(env, cadre) {
  const payload = b64urlDepuisTexte(JSON.stringify({
    u: cadre.rowId,
    fp: await empreinteCadre(cadre.fields),
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDES,
  }));
  return `${payload}.${await signer(env, payload)}`;
}

/** Contenu d'un jeton valide (signature + expiration), null sinon. */
async function lireSessionCadre(env, jeton) {
  const parts = String(jeton || "").split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  if (!safeEqual(parts[1], await signer(env, parts[0]))) return null;
  let payload;
  try {
    payload = JSON.parse(texteDepuisB64url(parts[0]));
  } catch {
    return null;
  }
  if (!payload || !Number.isInteger(payload.u) || payload.u <= 0) return null;
  if (!(payload.exp > Math.floor(Date.now() / 1000))) return null;
  return payload;
}

/** Comparaison de chaînes à temps constant (évite les attaques temporelles). */
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Vraie si `provided` correspond à la clé admin (secret env.ADMIN_KEY). */
function isAdminKey(env, provided) {
  const key = (env.ADMIN_KEY || "").trim();
  if (!key) return false;
  return safeEqual(typeof provided === "string" ? provided.trim() : "", key);
}

/** Crée les colonnes manquantes d'une table Grist (un seul GET, POST groupé).
 *  specs = [{ id, label, type }] (type par défaut : "Text"). */
async function ensureColumns(env, table, specs) {
  const data = await grist(env, "GET", `/tables/${table}/columns`);
  const existing = new Set((data.columns || []).map((c) => c.id));
  const missing = specs.filter((s) => !existing.has(s.id));
  if (!missing.length) return;
  await grist(env, "POST", `/tables/${table}/columns`, {
    columns: missing.map((s) => ({ id: s.id, fields: { label: s.label, type: s.type || "Text" } })),
  });
}

/** Crée une colonne unique si elle n'existe pas déjà. */
async function ensureColumn(env, table, colId, label, type) {
  await ensureColumns(env, table, [{ id: colId, label, type }]);
}

/** Ids contenus dans une cellule Grist de type Référence (nombre) ou Liste de références (["L", id, ...]). */
function refIds(value) {
  if (typeof value === "number" && value > 0) return [value];
  if (Array.isArray(value) && value[0] === "L") return value.slice(1).filter((id) => typeof id === "number");
  return [];
}

/**
 * Authentifie un cadre par email + code d'accès personnel (UTILISATEURS.Code_acces).
 * RÉSERVÉ À LA CONNEXION, qui vérifie ensuite le code PIN : toutes les autres
 * routes exigent le jeton de session (authenticateCadreSession).
 */
async function authenticateCadre(env, rawEmail, rawCode) {
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  const code = normaliserCodeAcces(rawCode);
  if (!email || !code) throw httpError(401, "Email ou code d'accès invalide");

  const users = await gristAll(env, T_UTILISATEURS);
  const match = users.find(
    (u) => (u.fields.Email || "").trim().toLowerCase() === email
      && safeEqual((u.fields.Code_acces || "").trim(), code)
  );
  if (!match) throw httpError(401, "Email ou code d'accès invalide");
  return chargerCadre(env, match);
}

/**
 * Authentifie un cadre par le jeton de session délivré à la connexion
 * (en-tête X-Cadre-Session). Le compte est relu à chaque requête : une
 * désactivation, un changement de code d'accès ou de PIN prend effet
 * immédiatement, sans attendre l'expiration du jeton.
 */
async function authenticateCadreSession(env, jeton) {
  const expiree = () => httpError(401, "Session expirée : reconnectez-vous");
  const payload = await lireSessionCadre(env, jeton);
  if (!payload) throw expiree();
  const rows = await gristFilter(env, T_UTILISATEURS, { id: [payload.u] });
  if (!rows.length) throw expiree();
  if (!safeEqual(payload.fp, await empreinteCadre(rows[0].fields))) throw expiree();
  return chargerCadre(env, rows[0]);
}

/** Contexte d'un cadre authentifié : compte actif + services qui lui sont ouverts. */
async function chargerCadre(env, match) {
  if (!match.fields.Utilisateur_de_l_outil) {
    throw httpError(403, "Ce compte a été désactivé : contactez l'administrateur");
  }

  // Droits d'administration (UTILISATEURS.Administrateur) : ouvrent l'espace
  // admin, et rien de plus — un administrateur ne voit les données d'un service
  // que s'il y est rattaché comme n'importe quel cadre.
  const estAdmin = match.fields.Administrateur === true;

  const services = await gristAll(env, T_SERVICES);
  const myServices = services.filter((s) => {
    if (!s.fields.Recoit_des_etudiant) return false;
    if (s.fields.Cadre_ref === match.id) return true;
    if (refIds(s.fields.Cadres_secondaires).includes(match.id)) return true;
    return refIds(s.fields.Pole_CSS).includes(match.id);
  });
  // Un administrateur n'a pas forcément de service à lui : il doit pouvoir se
  // connecter quand même, sans quoi personne ne pourrait rattacher les cadres.
  if (!myServices.length && !estAdmin) {
    throw httpError(403, "Aucun service ouvert aux étudiants ne vous est rattaché : contactez l'administrateur");
  }

  return {
    rowId: match.id,
    fields: match.fields,
    services: myServices,
    serviceIds: new Set(myServices.map((s) => s.id)),
    estAdmin,
  };
}

/* ------------------------------------------------------------------ */
/* Lecture : payload complet pour l'étudiant                           */
/* ------------------------------------------------------------------ */

async function buildPayload(env, student) {
  const [periodes, services, codes, sorties, users, feries, evaluations] = await Promise.all([
    gristFilter(env, T_PERIODES, { Code_anonymat: [student.code] }),
    gristAll(env, T_SERVICES),
    gristAll(env, T_CODES),
    gristFilter(env, T_SORTIES, { Anonymat: [student.rowId] }),
    gristAll(env, T_UTILISATEURS),
    gristAll(env, T_FERIES),
    gristAll(env, T_EVALUATIONS),
  ]);

  // Questionnaire de satisfaction déjà rempli : cf. buildCadrePayload — lien
  // par UUID de la période (Cle_lien), avec repli sur la référence directe.
  const periodeIdByUuid = new Map(
    periodes.map((p) => [p.fields.UUID, p.id]).filter(([uuid]) => uuid)
  );
  const periodesAvecReponse = new Set();
  for (const e of evaluations) {
    const periodeId = (e.fields.Cle_lien && periodeIdByUuid.get(e.fields.Cle_lien))
      || e.fields.Periode_de_stage || null;
    if (periodeId) periodesAvecReponse.add(periodeId);
  }

  const serviceById = new Map(services.map((s) => [s.id, s]));
  const usersById = new Map(users.map((u) => [u.id, u]));
  const codesById = new Map(codes.map((c) => [c.id, c]));
  const periodeIds = periodes.map((p) => p.id);

  // Jours fériés (dates ISO) et ajustements des sorties par jour de période
  const feriesSet = new Set(feries.map((f) => epochToIso(f.fields.Date)).filter(Boolean));
  const sortiesByJour = new Map();
  for (const s of sorties) {
    const per = s.fields.Pour_le_stage_du_ || s.fields.Rapprochement_manuel;
    const iso = epochToIso(s.fields.Date);
    if (per && iso) {
      const key = per + "|" + iso;
      sortiesByJour.set(key, (sortiesByJour.get(key) || 0) + (s.fields.Ajustement_h || 0));
    }
  }

  const semaines = periodeIds.length
    ? await gristFilter(env, T_HEBDO, { Periode: periodeIds })
    : [];

  // Heures par jour de chaque semaine + compteurs par période :
  // - un férié travaillé (heures > 0) ouvre un jour de récupération ; poser un
  //   jour au code RF (récupération de férié) le consomme ;
  // - les jours ABS alimentent le suivi de présence (arrêté du 31/07/2009 :
  //   présence >= 80 % par stage, franchise de 30 jours sur le cursus).
  const feriesIso = [...feriesSet];
  const recuperationByPeriode = {};
  const absencesByPeriode = {};
  const joursPrevusByPeriode = {};
  const semainesData = semaines.map((s) => {
    const debut = s.fields.Semaine_debut;
    const jours = DAY_COLUMNS.map((d, i) => {
      const codeRec = codesById.get(s.fields[d]);
      const iso = debut ? epochToIso(debut + i * 86400) : null;
      const info = jourInfo(codeRec, iso, s.fields.Periode, sortiesByJour, feriesSet);
      const per = s.fields.Periode;
      const codeTxt = codeRec ? (codeRec.fields.Code || "").trim().toUpperCase() : "";
      if (info.ferie && info.heures > 0) {
        recuperationByPeriode[per] = (recuperationByPeriode[per] || 0) + 1;
      }
      if (codeTxt === "RF") {
        recuperationByPeriode[per] = (recuperationByPeriode[per] || 0) - 1;
        info.recup = true;
      }
      // Jour prévu = jour où l'étudiant devait être présent (code qui compte
      // en stage) ou a été absent ; l'absence se repère au code ABS.
      if (codeTxt === "ABS") {
        absencesByPeriode[per] = (absencesByPeriode[per] || 0) + 1;
        joursPrevusByPeriode[per] = (joursPrevusByPeriode[per] || 0) + 1;
      } else if (codeRec && codeRec.fields.Compte_stage) {
        joursPrevusByPeriode[per] = (joursPrevusByPeriode[per] || 0) + 1;
      }
      return info;
    });
    return { s, jours };
  });

  return {
    etudiant: {
      prenom: student.fields.PRENOM || "",
      nom: student.fields.NOM || "",
      telephone: student.fields.Numero_de_telephone || "",
      email: student.fields.Adresse_mail || "",
      // L'e-mail n'est modifiable que par qui l'a déjà prouvé à la connexion
      // (voir updateProfilEtudiant) : le front grise le champ sinon.
      emailModifiable: student.deuxiemeFacteur === true,
    },
    motifs: MOTIFS,
    periodes: periodes.map((p) => {
      // Heures à réaliser : valeur Grist si > 0 (déjà nette des fériés), sinon
      // calcul auto = 35 h/semaine moins les jours fériés (accordés à l'étudiant).
      const heuresBase = Math.max(0, HEURES_PAR_SEMAINE * nombreSemaines(p.fields.Du, p.fields.Au)
        - HEURES_PAR_SEMAINE / 5 * nombreFeries(feriesIso, p.fields.Du, p.fields.Au));
      const aFaire = p.fields.A_FAIRE > 0 ? p.fields.A_FAIRE : heuresBase;
      const fait = p.fields.FAIT ?? 0;
      const service = serviceById.get(p.fields.Service);
      return {
        id: p.id,
        Du: epochToIso(p.fields.Du),
        Au: epochToIso(p.fields.Au),
        Service: (service && service.fields.Nom) || "",
        Niveau: p.fields.Niveau || "",
        En_cours: !!p.fields.En_cours,
        A_FAIRE: aFaire,
        FAIT: fait,
        Solde_heures: Math.round((fait - aFaire) * 100) / 100,
        Recuperation: Math.max(0, recuperationByPeriode[p.id] || 0),
        Absences: absencesByPeriode[p.id] || 0,
        Presence_pct: joursPrevusByPeriode[p.id]
          ? Math.round(100 * (1 - (absencesByPeriode[p.id] || 0) / joursPrevusByPeriode[p.id]))
          : null,
        Tuteur: p.fields.Tuteur || "",
        // Questionnaire de satisfaction : lien personnel de la période, et
        // indicateur de réponse pour ne plus proposer de le remplir deux fois.
        Lien_evaluation: p.fields.Lien_evaluation || "",
        Evaluation_repondue: periodesAvecReponse.has(p.id),
        cadre: cadreInfo(service, usersById),
      };
    }),
    // Suivi cursus : total des jours d'absence toutes périodes (franchise 30 j)
    absences_cursus: Object.values(absencesByPeriode).reduce((a, b) => a + b, 0),
    semaines: semainesData.map(({ s, jours }) => {
      const out = {
        id: s.id,
        Periode: s.fields.Periode,
        Semaine_debut: epochToIso(s.fields.Semaine_debut),
        Commentaire: s.fields.Commentaire || "",
        Total_h_semaine: s.fields.Total_h_semaine ?? null,
        jours,
      };
      for (const d of DAY_COLUMNS) out[d] = s.fields[d] || 0;
      return out;
    }),
    codes: codes.map((c) => ({
      id: c.id,
      Code: c.fields.Code || "",
      Libelle: c.fields.Libelle || "",
      Heure_debut: c.fields.Heure_debut || "",
      Heure_fin: c.fields.Heure_fin || "",
    })),
    sorties: sorties.map((s) => ({
      id: s.id,
      Motif: s.fields.Motif || "",
      Commentaire: s.fields.Motif_ou_Commentaire || "",
      Periode: s.fields.Pour_le_stage_du_ || s.fields.Rapprochement_manuel || null,
      Date: epochToIso(s.fields.Date),
      Heure_debut: s.fields.Heure_debut || "",
      Heure_fin: s.fields.Heure_fin || "",
      Compte_stage: !!s.fields.Compte_stage,
      Valide: !!s.fields.Valide,
      Duree_affichee: s.fields.Duree_affichee || "",
      Duree_heures: s.fields.Duree_heures ?? 0,
      Ajustement_h: s.fields.Ajustement_h ?? 0,
    })),
  };
}

/**
 * Identité de l'établissement qui déploie l'application (table ETABLISSEMENT,
 * première ligne). Public : ce sont les informations affichées dans l'en-tête
 * du site. Tolère l'absence de la table (valeurs vides -> le front garde son
 * affichage générique).
 */
async function getConfigEtablissement(env) {
  try {
    const records = await gristAll(env, T_ETABLISSEMENT);
    const f = (records[0] && records[0].fields) || {};
    return json({
      nom: f.Nom || "",
      description: f.Description || "",
      sousTitre: f.Sous_titre || "",
      logoId: premierePieceJointe(f.Logo),
      // Lien « Administration (Grist) » du pied de page (colonne facultative
      // Url_document_grist ; vide -> le front garde son lien par défaut).
      urlDocumentGrist: f.Url_document_grist || "",
      // Texte du pied de page (colonne facultative Texte_pied_de_page ;
      // vide -> le front garde son texte par défaut).
      textePiedDePage: f.Texte_pied_de_page || "",
      // Bandeau « Version bêta » (colonne bascule facultative
      // Afficher_bandeau_beta ; colonne absente ou cochée -> affiché).
      afficherBeta: f.Afficher_bandeau_beta !== false,
      // Domaine mail de l'établissement (colonne facultative DOMAINE_MAIL,
      // ex. "chu-exemple.fr" ou "@chu-exemple.fr") : ajuste les champs email
      // du site (placeholder + complétion automatique). Vide -> comportement
      // générique.
      domaineMail: String(f.DOMAINE_MAIL || "").trim().replace(/^@+/, "").toLowerCase(),
      // Habillage visuel du site (colonne bascule facultative
      // Mode_etablissement_public ; colonne absente ou cochée -> rendu DSFR
      // conforme aux conventions des services publics ; décochée -> habillage
      // "moderne" alternatif). Défaut à true = comportement actuel inchangé.
      modeEtablissementPublic: f.Mode_etablissement_public !== false,
    });
  } catch {
    return json({ nom: "", description: "", sousTitre: "", logoId: null, urlDocumentGrist: "", textePiedDePage: "", afficherBeta: true, domaineMail: "", modeEtablissementPublic: true });
  }
}

/** Id de la première pièce jointe d'une cellule Attachments (["L", id, …]). */
function premierePieceJointe(cellule) {
  return Array.isArray(cellule) && cellule.length > 1 && cellule[1] ? cellule[1] : null;
}

/**
 * Logo de l'établissement : proxifie le téléchargement de la pièce jointe
 * Grist (la clé API reste côté Worker). Servi avec un cache long : le front
 * ajoute ?v=<logoId> à l'URL, donc un nouveau logo change d'URL.
 */
async function getLogoEtablissement(env) {
  let attId = null;
  try {
    const records = await gristAll(env, T_ETABLISSEMENT);
    attId = premierePieceJointe(records[0] && records[0].fields && records[0].fields.Logo);
  } catch {
    attId = null;
  }
  if (!attId) throw httpError(404, "Aucun logo d'établissement");

  const base = (env.GRIST_BASE_URL || "https://grist.numerique.gouv.fr/api").replace(/\/$/, "");
  const res = await fetch(`${base}/docs/${env.GRIST_DOC_ID}/attachments/${attId}/download`, {
    headers: { Authorization: `Bearer ${env.GRIST_API_KEY}` },
  });
  if (!res.ok) throw httpError(404, "Logo introuvable");
  return new Response(res.body, {
    headers: {
      "Content-Type": res.headers.get("Content-Type") || "image/png",
      "Cache-Control": "public, max-age=86400",
    },
  });
}

/** Colonnes ETABLISSEMENT facultatives (le document d'origine ne les a pas
 *  forcément) : créées à la volée dès qu'un administrateur les renseigne
 *  depuis l'onglet « Établissement », comme PIN_hash pour un compte cadre.
 *  Nom, Description, Sous_titre et Logo sont supposées déjà présentes : ce
 *  sont les colonnes d'origine de la table, toujours lues par /api/config. */
const COLONNES_ETABLISSEMENT = [
  { id: "Url_document_grist", label: "Lien du pied de page", type: "Text" },
  { id: "Texte_pied_de_page", label: "Texte du pied de page", type: "Text" },
  { id: "Afficher_bandeau_beta", label: "Afficher le bandeau bêta", type: "Bool" },
  { id: "DOMAINE_MAIL", label: "Domaine mail de l'établissement", type: "Text" },
  { id: "Mode_etablissement_public", label: "Habillage public (DSFR)", type: "Bool" },
];

/** Première (et seule) ligne de la table ETABLISSEMENT, ou null si la table
 *  est vide ou absente. */
async function ligneEtablissement(env) {
  try {
    const records = await gristAll(env, T_ETABLISSEMENT);
    return records[0] || null;
  } catch {
    return null;
  }
}

/**
 * Paramètres de l'établissement pour l'écran d'administration : mêmes champs
 * que /api/config (voir getConfigEtablissement), mais destinés à être relus
 * puis modifiés depuis un formulaire, pas seulement affichés.
 */
async function listerEtablissementAdmin(env) {
  const ligne = await ligneEtablissement(env);
  const f = (ligne && ligne.fields) || {};
  return {
    nom: f.Nom || "",
    description: f.Description || "",
    sousTitre: f.Sous_titre || "",
    logoId: premierePieceJointe(f.Logo),
    urlDocumentGrist: f.Url_document_grist || "",
    textePiedDePage: f.Texte_pied_de_page || "",
    afficherBeta: f.Afficher_bandeau_beta !== false,
    domaineMail: f.DOMAINE_MAIL || "",
    modeEtablissementPublic: f.Mode_etablissement_public !== false,
  };
}

/** L'administrateur modifie les paramètres de l'établissement (table à une
 *  seule ligne, créée au besoin — un document tout neuf n'en a pas encore). */
async function modifierEtablissementAdmin(request, env, info) {
  const body = await request.json().catch(() => ({}));
  const fields = {};
  if (body.nom !== undefined) fields.Nom = cleanText(body.nom, 120);
  if (body.description !== undefined) fields.Description = cleanText(body.description, 300);
  if (body.sousTitre !== undefined) fields.Sous_titre = cleanText(body.sousTitre, 160);
  if (body.urlDocumentGrist !== undefined) fields.Url_document_grist = cleanText(body.urlDocumentGrist, 300);
  if (body.textePiedDePage !== undefined) fields.Texte_pied_de_page = cleanText(body.textePiedDePage, 500);
  if (body.domaineMail !== undefined) fields.DOMAINE_MAIL = cleanText(body.domaineMail, 120).replace(/^@+/, "");
  if (body.afficherBeta !== undefined) fields.Afficher_bandeau_beta = !!body.afficherBeta;
  if (body.modeEtablissementPublic !== undefined) fields.Mode_etablissement_public = !!body.modeEtablissementPublic;
  if (!Object.keys(fields).length) throw httpError(400, "Aucune modification fournie");
  if (body.nom !== undefined && !fields.Nom) throw httpError(400, "Le nom de l'établissement est obligatoire");

  await ensureColumns(env, T_ETABLISSEMENT, COLONNES_ETABLISSEMENT);
  const ligne = await ligneEtablissement(env);
  if (ligne) {
    await gristUpdate(env, T_ETABLISSEMENT, ligne.id, fields);
  } else {
    await grist(env, "POST", `/tables/${T_ETABLISSEMENT}/records`, { records: [{ fields }] });
  }
  if (info) info.detail = Object.keys(fields).join(", ");
  return json(await listerEtablissementAdmin(env));
}

/** Envoie un fichier en pièce jointe Grist (stockage partagé par toutes les
 *  colonnes Attachments du document) et renvoie son id, à poser sur la
 *  cellule concernée (ex. `["L", attId]`). */
async function envoyerPieceJointeGrist(env, file, nomParDefaut) {
  const up = new FormData();
  up.append("upload", file, file.name || nomParDefaut || "fichier");
  const base = (env.GRIST_BASE_URL || "https://grist.numerique.gouv.fr/api").replace(/\/$/, "");
  const res = await fetch(`${base}/docs/${env.GRIST_DOC_ID}/attachments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.GRIST_API_KEY}` },
    body: up,
  });
  if (!res.ok) {
    console.error(`Grist attachments POST -> ${res.status}: ${await res.text()}`);
    // Le statut Grist figure dans le message affiché : sans lui, diagnostiquer
    // une panne de pièces jointes oblige à rebrancher `wrangler tail`.
    const cause =
      res.status >= 500
        ? "Grist n'a pas pu enregistrer le fichier (panne ou stockage saturé)"
        : "Grist a refusé le fichier";
    throw httpError(502, `${cause} — erreur ${res.status}`);
  }
  const attachs = await res.json().catch(() => null);
  const attId = Array.isArray(attachs) ? attachs[0] : null;
  if (!attId) throw httpError(502, "Réponse inattendue de Grist après l'envoi du fichier");
  return attId;
}

/** L'administrateur envoie un nouveau logo (multipart/form-data, champ
 *  "logo") : la pièce jointe part chez Grist, puis la ligne ETABLISSEMENT est
 *  mise à jour pour pointer dessus. L'ancienne pièce jointe reste dans le
 *  document (Grist ne l'efface pas), mais n'est plus référencée nulle part. */
async function televerserLogoEtablissement(request, env, info) {
  const form = await request.formData().catch(() => null);
  const file = form ? form.get("logo") : null;
  if (!file || typeof file === "string") throw httpError(400, "Fichier logo manquant");
  if (!file.type || !file.type.startsWith("image/")) throw httpError(400, "Le logo doit être une image");
  if (file.size > 3 * 1024 * 1024) throw httpError(400, "Image trop lourde (3 Mo maximum)");

  const attId = await envoyerPieceJointeGrist(env, file, "logo");

  const ligne = await ligneEtablissement(env);
  const fields = { Logo: ["L", attId] };
  if (ligne) {
    await gristUpdate(env, T_ETABLISSEMENT, ligne.id, fields);
  } else {
    await grist(env, "POST", `/tables/${T_ETABLISSEMENT}/records`, { records: [{ fields }] });
  }
  if (info) info.detail = file.name || "";
  return json({ logoId: attId });
}

/** Retire le logo actuel (la ligne ETABLISSEMENT reste, seule sa colonne Logo
 *  est vidée) : le site retombe sur le monogramme de repli. */
async function supprimerLogoEtablissement(env, info) {
  const ligne = await ligneEtablissement(env);
  if (ligne && ligne.fields.Logo) {
    await gristUpdate(env, T_ETABLISSEMENT, ligne.id, { Logo: ["L"] });
  }
  if (info) info.detail = "logo retiré";
  return json({ ok: true });
}

async function listServices(env) {
  const [services, users, sites] = await Promise.all([
    gristAll(env, T_SERVICES),
    gristAll(env, T_UTILISATEURS),
    gristAll(env, T_SITES),
  ]);
  const usersById = new Map(users.map((u) => [u.id, u]));
  const sitesById = new Map(sites.map((s) => [s.id, s]));
  return json({
    services: services
      .filter((s) => s.fields.Recoit_des_etudiant)
      .map((s) => ({
        id: s.id,
        Nom: s.fields.Nom || "",
        Site: siteName(s, sitesById),
        cadre: cadreInfo(s, usersById),
      })),
    civilites: CIVILITES,
    formations: FORMATIONS,
    niveaux: NIVEAUX,
  });
}

/** Nom du site (table SITES) lié à un service. */
function siteName(service, sitesById) {
  const site = sitesById.get(service.fields.Site);
  return (site && site.fields.NOM) || "";
}

/* ------------------------------------------------------------------ */
/* Espace cadre                                                        */
/* ------------------------------------------------------------------ */

/** Payload complet des services/étudiants/planning rattachés au cadre. */
async function buildCadrePayload(env, cadre) {
  const [periodesAll, students, codes, feries, evaluations, servicesAll, sites, rdvsAll, commentaires] = await Promise.all([
    gristAll(env, T_PERIODES),
    gristAll(env, T_ETUDIANTS),
    gristAll(env, T_CODES),
    gristAll(env, T_FERIES),
    gristAll(env, T_EVALUATIONS),
    gristAll(env, T_SERVICES),
    gristAll(env, T_SITES),
    gristAll(env, T_RDV),
    gristAll(env, T_COMMENTAIRES),
  ]);

  // Bilan final : reconnu parmi les commentaires/pièces jointes de chaque
  // période par son texte (voir MOTIF_BILAN) — pas de colonne dédiée.
  const periodesAvecBilan = new Set(
    commentaires.filter((c) => MOTIF_BILAN.test(c.fields.Commentaire || "")).map((c) => c.fields.Periode_de_stage)
  );

  const servicesById = new Map(servicesAll.map((s) => [s.id, s]));
  const sitesById = new Map(sites.map((s) => [s.id, s]));
  const periodes = periodesAll.filter((p) => cadre.serviceIds.has(p.fields.Service));
  // Historique : les stages de ces mêmes étudiants dans d'autres services sont
  // aussi envoyés (lecture seule côté front) pour que le cadre voie le parcours
  // complet. Planning, sorties et déclarations restent limités à ses services.
  const etudiantIds = new Set(periodes.map((p) => p.fields.Etudiant).filter(Boolean));
  const periodesAutres = periodesAll.filter((p) =>
    !cadre.serviceIds.has(p.fields.Service) && etudiantIds.has(p.fields.Etudiant));
  const periodeIds = periodes.map((p) => p.id);
  const periodeIdSet = new Set(periodeIds);
  const etudiantsById = new Map(students.map((e) => [e.id, e]));
  const codesById = new Map(codes.map((c) => [c.id, c]));
  const feriesSet = new Set(feries.map((f) => epochToIso(f.fields.Date)).filter(Boolean));
  const feriesIso = [...feriesSet];

  // Une évaluation se rattache à une période soit par sa clé (Cle_lien ==
  // PERIODES_DE_STAGE.UUID, cas normal du lien envoyé par mail), soit par la
  // référence directe Periode_de_stage (repli).
  const periodeIdByUuid = new Map(
    periodesAll.map((p) => [p.fields.UUID, p.id]).filter(([uuid]) => uuid)
  );
  const periodesAvecReponse = new Set();
  const evaluationsRattachees = [];
  for (const e of evaluations) {
    const periodeId = (e.fields.Cle_lien && periodeIdByUuid.get(e.fields.Cle_lien))
      || e.fields.Periode_de_stage || null;
    if (!periodeId) continue;
    periodesAvecReponse.add(periodeId);
    evaluationsRattachees.push({ periodeId, fields: e.fields, id: e.id });
  }

  const studentIds = [...new Set(periodes.map((p) => p.fields.Etudiant).filter(Boolean))];
  const sortiesAll = studentIds.length ? await gristFilter(env, T_SORTIES, { Anonymat: studentIds }) : [];
  const sorties = sortiesAll.filter((s) => {
    const per = s.fields.Pour_le_stage_du_ || s.fields.Rapprochement_manuel;
    return periodeIdSet.has(per);
  });

  const sortiesByJour = new Map();
  for (const s of sorties) {
    const per = s.fields.Pour_le_stage_du_ || s.fields.Rapprochement_manuel;
    const iso = epochToIso(s.fields.Date);
    if (per && iso) {
      const key = per + "|" + iso;
      sortiesByJour.set(key, (sortiesByJour.get(key) || 0) + (s.fields.Ajustement_h || 0));
    }
  }

  const semaines = periodeIds.length ? await gristFilter(env, T_HEBDO, { Periode: periodeIds }) : [];
  const semainesData = semaines.map((s) => {
    const debut = s.fields.Semaine_debut;
    const jours = DAY_COLUMNS.map((d, i) => {
      const codeRec = codesById.get(s.fields[d]);
      const iso = debut ? epochToIso(debut + i * 86400) : null;
      return jourInfo(codeRec, iso, s.fields.Periode, sortiesByJour, feriesSet);
    });
    return { s, jours };
  });

  // Rendez-vous formateur/tuteur des seules périodes rattachées au cadre.
  const rdvs = rdvsAll.filter((r) => periodeIdSet.has(r.fields.Periode));

  return {
    services: cadre.services.map((s) => ({
      id: s.id,
      Nom: s.fields.Nom || "",
      Site: siteName(s, sitesById),
      // Codes horaires activés pour ce service (liste vide = tous les codes)
      Codes: refIds(s.fields.Codes_horaires),
      // Modèle de mail de bienvenue propre au service (facultatif ; colonnes
      // SERVICES.Mail_bienvenue_objet / Mail_bienvenue_corps, "" si absentes).
      Mail_objet: s.fields.Mail_bienvenue_objet || "",
      Mail_corps: s.fields.Mail_bienvenue_corps || "",
    })),
    niveaux: NIVEAUX,
    formations: FORMATIONS,
    civilites: CIVILITES,
    motifs: MOTIFS,
    rdvTypes: RDV_TYPES,
    moi: {
      nom: cadreNomComplet(cadre),
      prenom: cadre.fields.Prenom || "",
      telephone: cadre.fields.Telephone || "",
      // Droits d'administration : le front n'affiche l'accès à l'espace admin
      // que dans ce cas (le contrôle réel se fait à chaque appel, côté serveur).
      admin: cadre.estAdmin === true,
    },
    feries: feriesIso,
    periodes: [...periodes, ...periodesAutres].map((p) => {
      // Le code anonymat est nécessaire : c'est le cadre qui le redonne à un
      // étudiant qui l'aurait oublié.
      const etu = etudiantsById.get(p.fields.Etudiant);
      const svc = servicesById.get(p.fields.Service);
      const fait = p.fields.FAIT ?? 0;
      const aFaire = p.fields.A_FAIRE ?? 0;
      return {
        id: p.id,
        Service: p.fields.Service,
        Service_nom: (svc && svc.fields.Nom) || "",
        Etudiant: {
          id: p.fields.Etudiant,
          nom: etu ? etu.fields.NOM || "" : "",
          prenom: etu ? etu.fields.PRENOM || "" : "",
          formation: etu ? etu.fields.FORMATION || "" : "",
          centre: etu ? etu.fields.Centre_de_formation || "" : "",
          email: etu ? etu.fields.Adresse_mail || "" : "",
          telephone: etu ? etu.fields.Numero_de_telephone || "" : "",
          ddn: etu ? epochToIso(etu.fields.DDN) : null,
          anonymat: etu ? etu.fields.Anonymat || "" : "",
        },
        Du: epochToIso(p.fields.Du),
        Au: epochToIso(p.fields.Au),
        Niveau: p.fields.Niveau || "",
        Tuteur: p.fields.Tuteur || "",
        Referent_pedagogique: p.fields.Referent_pedagogique || "",
        En_cours: !!p.fields.En_cours,
        A_FAIRE: aFaire,
        FAIT: fait,
        Solde_heures: Math.round((fait - aFaire) * 100) / 100,
        Lien_evaluation: p.fields.Lien_evaluation || "",
        Evaluation_envoyee: !!p.fields.Evaluation_envoyee,
        Evaluation_repondue: periodesAvecReponse.has(p.id),
        Bilan_final: periodesAvecBilan.has(p.id),
        Alertes: computeAlertesPeriode(p.id, semaines, codesById, epochToIso(p.fields.Du), epochToIso(p.fields.Au)),
      };
    }),
    semaines: semainesData.map(({ s, jours }) => {
      const out = {
        id: s.id,
        Periode: s.fields.Periode,
        Semaine_debut: epochToIso(s.fields.Semaine_debut),
        jours,
      };
      for (const d of DAY_COLUMNS) out[d] = s.fields[d] || 0;
      return out;
    }),
    codes: codes.map((c) => ({
      id: c.id,
      Code: c.fields.Code || "",
      Libelle: c.fields.Libelle || "",
      Heure_debut: c.fields.Heure_debut || "",
      Heure_fin: c.fields.Heure_fin || "",
    })),
    sorties: sorties.map((s) => ({
      id: s.id,
      Periode: s.fields.Pour_le_stage_du_ || s.fields.Rapprochement_manuel || null,
      Motif: s.fields.Motif || "",
      Commentaire: s.fields.Motif_ou_Commentaire || "",
      Date: epochToIso(s.fields.Date),
      Heure_debut: s.fields.Heure_debut || "",
      Heure_fin: s.fields.Heure_fin || "",
      Compte_stage: !!s.fields.Compte_stage,
      Valide: !!s.fields.Valide,
      Duree_heures: s.fields.Duree_heures ?? 0,
      Ajustement_h: s.fields.Ajustement_h ?? 0,
    })),
    rdvs: rdvs.map((r) => ({
      id: r.id,
      Periode: r.fields.Periode || null,
      Date_rdv: epochToIso(r.fields.Date_rdv),
      Type_de_rendez_vous: r.fields.Type_de_rendez_vous || "",
      Formateur: r.fields.Formateur || "",
      Commentaire: r.fields.Commentaire || "",
      Cree_par: r.fields.Cree_par || "",
    })),
    // Réponses au questionnaire de satisfaction, limitées aux stages des
    // services du cadre. Volontairement sans identité ni référence exploitable
    // vers l'étudiant : le dépouillement se fait de façon anonyme, seul l'id de
    // période sert à filtrer sur la période choisie côté front.
    evaluations: evaluationsRattachees
      .filter((e) => periodeIdSet.has(e.periodeId))
      .map((e) => {
        const reponses = {};
        for (const col of EVAL_COLONNES) {
          const v = champEvaluation(e.fields, col);
          reponses[col] = v == null ? "" : String(v).trim();
        }
        const note = Number(champEvaluation(e.fields, "note_globale"));
        const soumission = champEvaluation(e.fields, "date_soumission");
        return {
          id: e.id,
          Periode: e.periodeId,
          Date_soumission: typeof soumission === "number"
            ? epochToIso(soumission)
            : (soumission || null),
          Note_globale: Number.isFinite(note) && note > 0 ? note : null,
          reponses,
        };
      }),
  };
}

/**
 * Id d'étudiant à journaliser pour un cadre : renvoie l'id seulement si cet
 * étudiant a bien un stage dans un des services du cadre, undefined sinon.
 * Le journal ne doit pas pouvoir se remplir de noms d'étudiants arbitraires
 * envoyés par le navigateur.
 */
async function etudiantDuCadre(env, cadre, rawId) {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return undefined;
  const periodes = await gristFilter(env, T_PERIODES, { Etudiant: [id] }).catch(() => []);
  return periodes.some((p) => cadre.serviceIds.has(p.fields.Service)) ? id : undefined;
}

/** Vérifie que la période appartient à un service du cadre ; la renvoie sinon lève 403/404. */
async function ensurePeriodeInScope(env, cadre, periodeId) {
  if (!periodeId) throw httpError(403, "Aucune période rattachée");
  const rows = await gristFilter(env, T_PERIODES, { id: [periodeId] });
  if (!rows.length) throw httpError(404, "Période introuvable");
  if (!cadre.serviceIds.has(rows[0].fields.Service)) {
    throw httpError(403, "Cet étudiant n'appartient pas à l'un de vos services");
  }
  return rows[0];
}

/** Nom complet du cadre connecté (pour l'affichage "Imprimé par"). */
function cadreNomComplet(cadre) {
  return [cadre.fields.Civilite, cadre.fields.Nom, cadre.fields.Prenom]
    .map((x) => (x || "").trim()).filter(Boolean).join(" ");
}

/** Le cadre déclare des heures pour un étudiant de son service (reste en attente de validation). */
async function creerSortiePourEtudiant(request, env, cadre, info) {
  const body = await request.json().catch(() => ({}));
  const periodeId = Number(body.periodeId);
  const periode = await ensurePeriodeInScope(env, cadre, periodeId);
  verifierPeriodeNonVerrouillee(periode, "il n'est plus possible d'y déclarer des heures");

  const motif = String(body.Motif || "").trim().slice(0, 100);
  const date = String(body.Date || "");
  const debut = String(body.Heure_debut || "").trim();
  const fin = String(body.Heure_fin || "").trim();

  if (!MOTIFS.includes(motif)) throw httpError(400, "Motif invalide");
  const dateEpoch = exigerDate(date, "Date");
  if (!TIME_RE.test(debut) || !TIME_RE.test(fin)) {
    throw httpError(400, "Heures invalides (format attendu : HH:MM)");
  }

  const compteStage = motif.toUpperCase() === "RETARD" ? false : body.Compte_stage !== false;

  const fields = {
    Anonymat: periode.fields.Etudiant,
    Code_anonymat: periode.fields.Code_anonymat || "",
    Motif: motif,
    Motif_ou_Commentaire: cleanText(body.Commentaire, 200),
    Date: dateEpoch,
    Heure_debut: debut,
    Heure_fin: fin,
    Compte_stage: compteStage,
    Rapprochement_manuel: periodeId,
  };

  const data = await grist(env, "POST", `/tables/${T_SORTIES}/records`, { records: [{ fields }] });
  if (info) {
    info.etudiantId = periode.fields.Etudiant;
    info.serviceId = periode.fields.Service;
    info.detail = `${motif} du ${jDate(date)}, ${debut}–${fin}`
      + (compteStage ? "" : " (ne compte pas dans le stage)");
  }
  return json({ id: data.records[0].id }, 201);
}

/** Valide/dévalide une déclaration, et/ou en modifie le contenu (motif, date,
 * heures) tant qu'elle n'est pas validée. */
async function validerSortie(request, env, cadre, rowId, info) {
  const body = await request.json().catch(() => ({}));

  const rows = await gristFilter(env, T_SORTIES, { id: [rowId] });
  if (!rows.length) throw httpError(404, "Déclaration introuvable");
  const periodeId = rows[0].fields.Pour_le_stage_du_ || rows[0].fields.Rapprochement_manuel;
  const periode = await ensurePeriodeInScope(env, cadre, periodeId);

  const modifieContenu = body.Motif !== undefined || body.Commentaire !== undefined
    || body.Date !== undefined || body.Heure_debut !== undefined
    || body.Heure_fin !== undefined || body.Compte_stage !== undefined;
  if (modifieContenu && rows[0].fields.Valide) {
    throw httpError(403, "Cette déclaration est validée : dévalidez-la avant de la modifier");
  }

  const fields = {};
  if (body.Motif !== undefined) {
    const motif = String(body.Motif || "").trim().slice(0, 100);
    if (!motif) throw httpError(400, "Le motif est obligatoire");
    fields.Motif = motif;
  }
  if (body.Commentaire !== undefined) fields.Motif_ou_Commentaire = cleanText(body.Commentaire, 200);
  if (body.Date !== undefined) fields.Date = exigerDate(body.Date, "Date");
  if (body.Heure_debut !== undefined) {
    if (!TIME_RE.test(body.Heure_debut)) throw httpError(400, "Heure de début invalide (format HH:MM)");
    fields.Heure_debut = body.Heure_debut;
  }
  if (body.Heure_fin !== undefined) {
    if (!TIME_RE.test(body.Heure_fin)) throw httpError(400, "Heure de fin invalide (format HH:MM)");
    fields.Heure_fin = body.Heure_fin;
  }
  if (body.Compte_stage !== undefined) fields.Compte_stage = !!body.Compte_stage;
  if (body.Valide !== undefined) {
    if (typeof body.Valide !== "boolean") throw httpError(400, "Le champ Valide doit être un booléen");
    fields.Valide = body.Valide;
  }
  if (!Object.keys(fields).length) throw httpError(400, "Aucune modification fournie");

  await gristUpdate(env, T_SORTIES, rowId, fields);
  if (info) {
    info.etudiantId = periode.fields.Etudiant;
    info.serviceId = periode.fields.Service;
    const avant = rows[0].fields;
    // La déclaration est désignée par ce qu'elle est (motif, date, heures)
    // plutôt que par son numéro de ligne, illisible dans le journal.
    const quoi = `${avant.Motif || "déclaration"} du ${jDateEpoch(avant.Date)}`
      + `, ${avant.Heure_debut || "?"}–${avant.Heure_fin || "?"}`;
    const parts = [];
    if (body.Valide === true) parts.push("validée");
    else if (body.Valide === false) parts.push("dévalidée");
    parts.push(...changementsTexte({
      Motif: "motif",
      Date: ["date", true],
      Heure_debut: "début",
      Heure_fin: "fin",
      Compte_stage: "compte dans le stage",
      Motif_ou_Commentaire: "commentaire",
    }, avant, fields));
    info.detail = `${quoi}${parts.length ? " — " + parts.join(" · ") : ""}`;
  }
  return json({ ok: true });
}

/** Délai de grâce (jours) après la fin d'un stage avant verrouillage du
 *  planning et des rendez-vous. Même valeur côté espace-cadre.js. */
const JOURS_VERROU_PLANNING = 5;

/** Vrai si le stage appartient au passé — ni en cours, ni à venir. */
function periodeTerminee(fields) {
  if (fields.En_cours) return false;
  if (typeof fields.Au !== "number") return false;
  return epochToIso(fields.Au) < epochToIso(Math.floor(Date.now() / 1000));
}

/** Refuse la modification si le stage est terminé depuis plus de
 *  JOURS_VERROU_PLANNING jours (Au est un epoch à minuit UTC). */
function verifierPeriodeNonVerrouillee(periode, action) {
  const au = periode.fields.Au;
  if (typeof au !== "number" || periode.fields.En_cours) return;
  const verrouA = au + (JOURS_VERROU_PLANNING + 1) * 86400;
  if (Date.now() / 1000 >= verrouA) {
    throw httpError(403, `Ce stage est terminé depuis plus de ${JOURS_VERROU_PLANNING} jours : `
      + `${action}. En cas de besoin, contactez l'administrateur.`);
  }
}

async function updatePlanningJour(request, env, cadre, semaineId, info) {
  const body = await request.json().catch(() => ({}));
  const jour = String(body.jour || "");
  if (!DAY_COLUMNS.includes(jour)) throw httpError(400, "Jour invalide");
  const codeId = body.codeId === null || body.codeId === undefined ? null : Number(body.codeId);
  if (codeId !== null && !Number.isInteger(codeId)) throw httpError(400, "Code horaire invalide");

  const rows = await gristFilter(env, T_HEBDO, { id: [semaineId] });
  if (!rows.length) throw httpError(404, "Semaine introuvable");
  const periode = await ensurePeriodeInScope(env, cadre, rows[0].fields.Periode);
  verifierPeriodeNonVerrouillee(periode, "son planning est verrouillé");

  // Ancien et nouveau code lus ensemble (une seule requête) : le journal dit
  // ainsi ce qui a été remplacé, pas seulement ce qui a été posé.
  const ancienId = rows[0].fields[jour] || null;
  const ids = [...new Set([codeId, ancienId].filter(Boolean))];
  const codes = ids.length ? await gristFilter(env, T_CODES, { id: ids }) : [];
  const libelleCode = (id) => {
    if (!id) return "(vide)";
    const c = codes.find((x) => x.id === id);
    return (c && c.fields.Code) || `code #${id}`;
  };

  if (codeId !== null) {
    if (!codes.some((c) => c.id === codeId)) throw httpError(400, "Code horaire introuvable");
    // Codes limités au service (SERVICES.Codes_horaires ; liste vide = tous)
    const service = cadre.services.find((s) => s.id === periode.fields.Service);
    const actifs = service ? refIds(service.fields.Codes_horaires) : [];
    if (actifs.length && !actifs.includes(codeId)) {
      throw httpError(400, "Ce code horaire n'est pas activé pour ce service");
    }
  }

  await gristUpdate(env, T_HEBDO, semaineId, { [jour]: codeId });
  if (info) {
    info.etudiantId = periode.fields.Etudiant;
    info.serviceId = periode.fields.Service;
    const debutSemaine = rows[0].fields.Semaine_debut;
    const dateJour = typeof debutSemaine === "number"
      ? debutSemaine + DAY_COLUMNS.indexOf(jour) * 86400 : null;
    info.detail = `${jour} ${jDateEpoch(dateJour)} : ${libelleCode(ancienId)} → ${libelleCode(codeId)}`;
  }
  return json({ ok: true });
}

async function updatePeriode(request, env, cadre, periodeId, info) {
  const body = await request.json().catch(() => ({}));
  const rows = await gristFilter(env, T_PERIODES, { id: [periodeId] });
  if (!rows.length) throw httpError(404, "Période introuvable");
  if (!cadre.serviceIds.has(rows[0].fields.Service)) {
    throw httpError(403, "Cet étudiant n'appartient pas à l'un de vos services");
  }

  // La fiche (tuteur/niveau/dates) d'un stage TERMINÉ ne se modifie plus.
  // Un stage à venir, lui, reste éditable : c'est justement avant qu'il commence
  // qu'on corrige des dates saisies de travers. Evaluation_envoyee reste
  // modifiable dans tous les cas (elle s'envoie après la fin du stage).
  const modifieLaFiche = body.Tuteur !== undefined || body.Niveau !== undefined
    || body.Du !== undefined || body.Au !== undefined;
  if (modifieLaFiche && periodeTerminee(rows[0].fields)) {
    throw httpError(403, "Ce stage est terminé : sa fiche ne peut plus être modifiée");
  }

  const fields = {};
  if (body.Tuteur !== undefined) fields.Tuteur = cleanText(body.Tuteur, 80);
  if (body.Niveau !== undefined) {
    if (!NIVEAUX.includes(body.Niveau)) throw httpError(400, "Niveau invalide");
    fields.Niveau = body.Niveau;
  }
  if (body.Du !== undefined) fields.Du = exigerDate(body.Du, "Date de début");
  if (body.Au !== undefined) fields.Au = exigerDate(body.Au, "Date de fin");
  if (body.Evaluation_envoyee !== undefined) fields.Evaluation_envoyee = !!body.Evaluation_envoyee;
  const du = fields.Du !== undefined ? fields.Du : rows[0].fields.Du;
  const au = fields.Au !== undefined ? fields.Au : rows[0].fields.Au;
  if (typeof du === "number" && typeof au === "number") {
    if (du > au) throw httpError(400, "La fin du stage doit être après le début");
    // Contrôle de durée seulement si les dates changent : une période plus
    // longue déjà enregistrée reste modifiable sur ses autres champs.
    if (fields.Du !== undefined || fields.Au !== undefined) verifierDureeStage(du, au);
  }
  if (!Object.keys(fields).length) throw httpError(400, "Aucune modification fournie");

  await gristUpdate(env, T_PERIODES, periodeId, fields);
  if (info) {
    info.etudiantId = rows[0].fields.Etudiant;
    info.serviceId = rows[0].fields.Service;
    const changes = changementsTexte({
      Tuteur: "tuteur",
      Niveau: "niveau",
      Du: ["début", true],
      Au: ["fin", true],
      Evaluation_envoyee: "évaluation envoyée",
    }, rows[0].fields, fields);
    info.detail = `stage du ${jDateEpoch(rows[0].fields.Du)}`
      + (changes.length ? ` — ${changes.join(" · ")}` : "");
  }
  return json({ ok: true });
}

/**
 * Supprime une période de stage déclarée par erreur (service du cadre), avec
 * ses semaines de planning (PLANNING_HEBDO) et ses rendez-vous formateur.
 * Les déclarations Sortie_de_stage ne sont pas touchées : elles appartiennent
 * à l'étudiant et se rattachent par date via la formule Grist.
 */
async function supprimerPeriode(env, ctx, cadre, periodeId, info) {
  const periode = await ensurePeriodeInScope(env, cadre, periodeId);

  const [semaines, rdvs] = await Promise.all([
    gristFilter(env, T_HEBDO, { Periode: [periodeId] }),
    gristFilter(env, T_RDV, { Periode: [periodeId] }),
  ]);
  if (semaines.length) {
    await grist(env, "POST", `/tables/${T_HEBDO}/data/delete`, semaines.map((s) => s.id));
  }
  if (rdvs.length) {
    await grist(env, "POST", `/tables/${T_RDV}/data/delete`, rdvs.map((r) => r.id));
  }
  await grist(env, "POST", `/tables/${T_PERIODES}/data/delete`, [periodeId]);

  // Filet de sécurité : si une suppression précédente s'est interrompue à
  // mi-chemin, des semaines orphelines peuvent subsister ; on en profite.
  purgePlanningsOrphelins(env, ctx);

  if (info) {
    info.etudiantId = periode.fields.Etudiant;
    info.serviceId = periode.fields.Service;
    info.detail = `stage du ${jDateEpoch(periode.fields.Du)} au ${jDateEpoch(periode.fields.Au)}`
      + ` — ${semaines.length} semaine(s) et ${rdvs.length} RDV supprimés`;
  }
  return json({ ok: true, semainesSupprimees: semaines.length, rdvsSupprimes: rdvs.length });
}

/** Renvoie le HTML de la fiche de stage imprimable (colonne formule
 * PERIODES_DE_STAGE.Planning_HTML) pour une période d'un service du cadre. */
async function planningImprimable(request, env, cadre, periodeId, info) {
  const periode = await ensurePeriodeInScope(env, cadre, periodeId);
  const html = periode.fields.Planning_HTML;
  if (!html) throw httpError(404, "La fiche de stage imprimable n'est pas disponible pour ce stage");
  if (info) {
    info.etudiantId = periode.fields.Etudiant;
    info.serviceId = periode.fields.Service;
    info.detail = `stage du ${jDateEpoch(periode.fields.Du)} au ${jDateEpoch(periode.fields.Au)}`;
  }
  return json({ html: await ficheAvecLogoEtablissement(request, env, html) });
}

/**
 * Aligne le logo de la fiche de stage imprimée sur celui de l'en-tête du site.
 * La formule Grist Planning_HTML embarque une image figée : elle reste celle de
 * l'établissement d'origine tant que la formule n'est pas rééditée à la main.
 * On réécrit donc la première image de la fiche (le logo de son en-tête) vers
 * la pièce jointe ETABLISSEMENT.Logo, servie par /api/config/logo — un logo
 * changé dans Grist s'imprime aussitôt, sans toucher à la formule. Sans logo
 * dans Grist, l'image est retirée plutôt que d'imprimer une identité périmée.
 */
async function ficheAvecLogoEtablissement(request, env, html) {
  const balise = /<img\b[^>]*>/i;
  if (!balise.test(html)) return html;

  let logoId = null;
  try {
    const records = await gristAll(env, T_ETABLISSEMENT);
    logoId = premierePieceJointe(records[0] && records[0].fields && records[0].fields.Logo);
  } catch {
    // Table ETABLISSEMENT illisible : rien de mieux à proposer que l'image de
    // la formule, on la laisse en place plutôt que d'imprimer une fiche nue.
    return html;
  }
  if (!logoId) return html.replace(balise, () => "");

  // ?v=<logoId> : même invalidation de cache que l'en-tête du site (le logo est
  // servi avec un cache long), donc un nouveau logo change d'URL.
  const src = ` src="${new URL(request.url).origin}/api/config/logo?v=${encodeURIComponent(logoId)}"`;
  const attributSrc = /\ssrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i;
  return html.replace(balise, (img) => (attributSrc.test(img)
    ? img.replace(attributSrc, () => src)
    : img.replace(/<img\b/i, () => `<img${src}`)));
}

/** Le cadre ajoute un rendez-vous formateur/tuteur pour un étudiant de son service. */
async function creerRdv(request, env, cadre, info) {
  const body = await request.json().catch(() => ({}));
  const periodeId = Number(body.periodeId);
  const periode = await ensurePeriodeInScope(env, cadre, periodeId);

  verifierPeriodeNonVerrouillee(periode, "il n'est plus possible d'y ajouter un rendez-vous");

  const type = cleanText(body.Type_de_rendez_vous, 80);
  const date = String(body.Date_rdv || "");
  if (!type) throw httpError(400, "Le type de rendez-vous est obligatoire");
  const dateRdv = exigerDate(date, "Date de rendez-vous");

  const fields = {
    Periode: periodeId,
    Date_rdv: dateRdv,
    Type_de_rendez_vous: type,
    Formateur: cleanText(body.Formateur, 80),
    Commentaire: cleanText(body.Commentaire, 300),
    Cree_par: cadreNomComplet(cadre),
  };

  const data = await grist(env, "POST", `/tables/${T_RDV}/records`, { records: [{ fields }] });
  if (info) {
    info.etudiantId = periode.fields.Etudiant;
    info.serviceId = periode.fields.Service;
    info.detail = `${type} le ${jDate(date)}${fields.Formateur ? ` avec ${fields.Formateur}` : ""}`;
  }
  return json({ id: data.records[0].id }, 201);
}

/** Le cadre supprime un rendez-vous formateur d'un étudiant de son service. */
async function supprimerRdv(env, cadre, rowId, info) {
  const rows = await gristFilter(env, T_RDV, { id: [rowId] });
  if (!rows.length) throw httpError(404, "Rendez-vous introuvable");
  const periode = await ensurePeriodeInScope(env, cadre, rows[0].fields.Periode);
  verifierPeriodeNonVerrouillee(periode, "ses rendez-vous ne peuvent plus être supprimés");
  await grist(env, "POST", `/tables/${T_RDV}/data/delete`, [rowId]);
  if (info) {
    info.etudiantId = periode.fields.Etudiant;
    info.serviceId = periode.fields.Service;
    info.detail = `${rows[0].fields.Type_de_rendez_vous || "rendez-vous"}`
      + ` du ${jDateEpoch(rows[0].fields.Date_rdv)}`
      + (rows[0].fields.Formateur ? ` avec ${rows[0].fields.Formateur}` : "");
  }
  return json({ ok: true });
}

/** Le cadre choisit les codes horaires actifs de son service
 * (SERVICES.Codes_horaires, liste de références ; vide = tous les codes). */
async function updateCodesService(request, env, cadre, serviceId, info) {
  if (!cadre.serviceIds.has(serviceId)) {
    throw httpError(403, "Ce service ne vous est pas rattaché");
  }
  const body = await request.json().catch(() => ({}));
  if (!Array.isArray(body.codes)) throw httpError(400, "Liste de codes invalide");
  const ids = [...new Set(body.codes.map(Number))];
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw httpError(400, "Liste de codes invalide");
  }
  // Ancienne liste lue en même temps que la nouvelle : le journal peut dire
  // quels codes ont été ajoutés ou retirés (liste vide = tous les codes).
  const svc = cadre.services.find((s) => s.id === serviceId);
  const anciens = refIds(svc && svc.fields.Codes_horaires);
  const tousIds = [...new Set([...ids, ...anciens])];
  const codes = tousIds.length ? await gristFilter(env, T_CODES, { id: tousIds }) : [];
  if (ids.some((id) => !codes.some((c) => c.id === id))) {
    throw httpError(400, "Code horaire introuvable");
  }
  await gristUpdate(env, T_SERVICES, serviceId, {
    Codes_horaires: ids.length ? ["L", ...ids] : null,
  });
  if (info) {
    const libelleCode = (id) => {
      const c = codes.find((x) => x.id === id);
      return (c && c.fields.Code) || `code #${id}`;
    };
    info.serviceId = serviceId;
    const parts = [];
    if (anciens.length) {
      const ajouts = ids.filter((id) => !anciens.includes(id)).map(libelleCode);
      const retraits = anciens.filter((id) => !ids.includes(id)).map(libelleCode);
      if (ajouts.length) parts.push(`ajout : ${ajouts.join(", ")}`);
      if (retraits.length) parts.push(`retrait : ${retraits.join(", ")}`);
    } else if (ids.length) {
      parts.push(ids.map(libelleCode).join(", "));
    }
    info.detail = (ids.length ? `${ids.length} code(s) actif(s)` : "tous les codes")
      + (parts.length ? ` — ${parts.join(" · ")}` : "");
  }
  return json({ ok: true, codes: ids });
}

/** Le cadre crée un code horaire (table CODES_HORAIRES, partagée entre tous
 * les services). Doublon refusé sur le texte du Code ; aucune suppression
 * possible via l'espace cadre. Si serviceId est fourni et que le service a
 * une liste de codes explicite, le nouveau code y est ajouté. */
async function creerCodeHoraire(request, env, cadre, info) {
  const body = await request.json().catch(() => ({}));
  const code = cleanText(body.Code, 10).toUpperCase();
  const libelle = cleanText(body.Libelle, 80);
  const debut = String(body.Heure_debut || "").trim();
  const fin = String(body.Heure_fin || "").trim();

  if (!code) throw httpError(400, "Le code est obligatoire");
  if (!libelle) throw httpError(400, "Le libellé est obligatoire");
  // Les deux heures ensemble, ou aucune (code sans horaire type absence)
  if (!!debut !== !!fin) throw httpError(400, "Renseignez l'heure de début ET de fin, ou aucune des deux");
  if (debut && (!TIME_RE.test(debut) || !TIME_RE.test(fin))) {
    throw httpError(400, "Heures invalides (format attendu : HH:MM)");
  }

  const existants = await gristAll(env, T_CODES);
  if (existants.some((c) => (c.fields.Code || "").trim().toUpperCase() === code)) {
    throw httpError(409, `Le code « ${code} » existe déjà : reprenez-le dans la liste des codes disponibles`);
  }

  const created = await grist(env, "POST", `/tables/${T_CODES}/records`, {
    records: [{ fields: {
      Code: code,
      Libelle: libelle,
      Heure_debut: debut,
      Heure_fin: fin,
      Compte_stage: body.Compte_stage !== false,
    } }],
  });
  const newId = created.records[0].id;

  // Active le nouveau code dans le service demandé si sa liste est explicite
  // (liste vide = tous les codes : rien à faire, il est déjà inclus).
  const serviceId = Number(body.serviceId);
  if (cadre.serviceIds.has(serviceId)) {
    const service = cadre.services.find((s) => s.id === serviceId);
    const actifs = refIds(service.fields.Codes_horaires);
    if (actifs.length) {
      await gristUpdate(env, T_SERVICES, serviceId, { Codes_horaires: ["L", ...actifs, newId] });
    }
  }

  if (info) {
    if (cadre.serviceIds.has(serviceId)) info.serviceId = serviceId;
    info.detail = `${code} — ${libelle}${debut ? ` (${debut}–${fin})` : " (sans horaire)"}`
      + (body.Compte_stage === false ? ", ne compte pas dans le stage" : "");
  }
  return json({ id: newId }, 201);
}

/* ------------------------------------------------------------------ */
/* Espace administrateur : les comptes cadres                          */
/* ------------------------------------------------------------------ */

/* Colonnes de UTILISATEURS que l'espace admin pilote. Créées à la demande,
   comme celles du PIN : une installation existante n'a rien à préparer.
   PIN_hash n'y figure pas — un PIN ne se lit ni ne se saisit, il se
   réinitialise (Reinit_PIN), et il est de toute façon créé à la connexion. */
const COLONNES_COMPTE_CADRE = [
  { id: "Code_acces", label: "Code d'accès", type: "Text" },
  { id: "Utilisateur_de_l_outil", label: "Utilisateur de l'outil", type: "Bool" },
  { id: "Administrateur", label: "Administrateur", type: "Bool" },
  { id: "Reinit_PIN", label: "Réinitialiser le PIN", type: "Bool" },
  { id: "PIN_essais", label: "PIN — essais manqués", type: "Int" },
  { id: "PIN_bloque_jusqu_a", label: "PIN — bloqué jusqu'à", type: "Int" },
];

/* Code d'accès : uniquement des chiffres, 4 au minimum et 6 au maximum — comme
   le PIN. Un code qui se dicte au téléphone et se recopie sans faute, au prix
   d'un espace de tirage réduit (10⁶ au plus) : c'est le PIN, haché et verrouillé
   après PIN_ESSAIS_MAX essais, qui reste la barrière dure de la connexion.
   La génération prend toujours la borne haute ; la borne basse n'existe que
   pour accepter un code plus court saisi à la main dans le document Grist. */
const LONGUEUR_CODE_ACCES = 6;

/** Code d'accès aléatoire (1ᵉʳ facteur d'un cadre) : LONGUEUR_CODE_ACCES chiffres.
 *  Les octets ≥ 250 sont écartés — 250 est le plus grand multiple de 10 sous 256,
 *  sinon les chiffres 0 à 5 sortiraient plus souvent que les autres. */
function genererCodeAcces() {
  let code = "";
  while (code.length < LONGUEUR_CODE_ACCES) {
    for (const o of crypto.getRandomValues(new Uint8Array(LONGUEUR_CODE_ACCES))) {
      if (o >= 250) continue;
      code += o % 10;
      if (code.length === LONGUEUR_CODE_ACCES) break;
    }
  }
  return code;
}

/** Code d'accès saisi, ramené à sa forme canonique. Les espaces d'un
 *  copier-coller sont tolérés ; tout ce qui n'est pas 4 à 6 chiffres est
 *  refusé sans lire le document (chaîne vide). */
function normaliserCodeAcces(brut) {
  const code = typeof brut === "string" ? brut.replace(/\s+/g, "") : "";
  return /^\d{4,6}$/.test(code) ? code : "";
}

/**
 * Vrai si UTILISATEURS.Email est une colonne FORMULE. C'est le cas courant :
 * l'adresse se calcule à partir du nom et du prénom (prenom.nom@domaine). Elle
 * ne peut alors pas être saisie, et l'écran d'administration masque le champ.
 */
async function emailCadreCalcule(env) {
  const data = await grist(env, "GET", `/tables/${T_UTILISATEURS}/columns`);
  return (data.columns || []).some((c) =>
    c.id === "Email" && c.fields && c.fields.isFormula === true && !!c.fields.formula);
}

/** Tout ce qu'affiche l'écran « Cadres » : comptes, services et état des PIN. */
async function listerCadresAdmin(env, admin) {
  await ensureColumns(env, T_UTILISATEURS, COLONNES_COMPTE_CADRE);
  const [users, services, sites, emailAuto] = await Promise.all([
    gristAll(env, T_UTILISATEURS),
    gristAll(env, T_SERVICES),
    gristAll(env, T_SITES),
    emailCadreCalcule(env),
  ]);
  const sitesById = new Map(sites.map((s) => [s.id, s]));
  const maintenant = Math.floor(Date.now() / 1000);

  return {
    emailAuto,
    civilites: CIVILITES,
    // Qui est connecté : le front signe l'invitation avec ce nom, et sait quelles
    // cases griser (on ne se désactive pas, on ne se retire pas ses droits).
    moi: { id: admin.rowId, nom: cadreNomComplet(admin) },
    services: services.map((s) => ({
      id: s.id,
      Nom: s.fields.Nom || "",
      Site: siteName(s, sitesById),
      Recoit_des_etudiant: !!s.fields.Recoit_des_etudiant,
      // Rattachements : le référent et le CSS de pôle s'affichent, mais seuls
      // les rattachements secondaires se modifient depuis cet écran.
      Cadre_ref: s.fields.Cadre_ref || null,
      Cadres_secondaires: refIds(s.fields.Cadres_secondaires),
      Pole_CSS: refIds(s.fields.Pole_CSS),
    })),
    cadres: users.map((u) => {
      const bloqueJusqua = Number(u.fields.PIN_bloque_jusqu_a) || 0;
      return {
        id: u.id,
        Civilite: u.fields.Civilite || "",
        Nom: u.fields.Nom || "",
        Prenom: u.fields.Prenom || "",
        Email: (u.fields.Email || "").trim(),
        Telephone: u.fields.Telephone || "",
        // 1ᵉʳ facteur : l'administrateur doit pouvoir le relire pour le
        // retransmettre à un cadre qui l'a perdu.
        Code_acces: (u.fields.Code_acces || "").trim(),
        Actif: u.fields.Utilisateur_de_l_outil === true,
        Administrateur: u.fields.Administrateur === true,
        // État du 2ᵉ facteur — jamais le PIN lui-même, qui n'est stocké que haché.
        PIN_defini: !!(u.fields.PIN_hash || "").trim(),
        PIN_reinit_demande: u.fields.Reinit_PIN === true,
        PIN_essais: Number(u.fields.PIN_essais) || 0,
        PIN_bloque_secondes: bloqueJusqua > maintenant ? bloqueJusqua - maintenant : 0,
      };
    }),
  };
}

/**
 * Rattache (ou détache) un cadre aux services demandés, via
 * SERVICES.Cadres_secondaires. Le cadre RÉFÉRENT d'un service (Cadre_ref) et le
 * CSS de pôle (Pole_CSS, une formule) portent leur rattachement ailleurs : ils
 * s'affichent dans l'écran mais ne se décochent pas ici, sinon on laisserait un
 * service sans responsable. Renvoie le nombre de services modifiés, ou null si
 * la requête ne demandait aucun changement de rattachement.
 */
async function rattacherServicesCadre(env, cadreId, demandes) {
  if (!Array.isArray(demandes)) return null;
  const voulus = new Set(demandes.map(Number).filter((n) => Number.isInteger(n) && n > 0));
  const services = await gristAll(env, T_SERVICES);
  const modifs = [];
  for (const s of services) {
    if (s.fields.Cadre_ref === cadreId) continue;
    if (refIds(s.fields.Pole_CSS).includes(cadreId)) continue;
    const secondaires = refIds(s.fields.Cadres_secondaires);
    const estRattache = secondaires.includes(cadreId);
    if (estRattache === voulus.has(s.id)) continue;
    const liste = estRattache
      ? secondaires.filter((id) => id !== cadreId)
      : [...secondaires, cadreId];
    modifs.push({ id: s.id, fields: { Cadres_secondaires: ["L", ...liste] } });
  }
  if (!modifs.length) return 0;
  await grist(env, "PATCH", `/tables/${T_SERVICES}/records`, { records: modifs });
  return modifs.length;
}

/** L'administrateur crée un compte cadre. Le code d'accès est tiré au sort ici :
 *  il n'est jamais choisi à la main, et il s'affiche une fois à la création. */
async function creerCadreAdmin(request, env, info) {
  const body = await request.json().catch(() => ({}));
  await ensureColumns(env, T_UTILISATEURS, COLONNES_COMPTE_CADRE);

  const nom = cleanText(body.Nom, 80);
  const prenom = cleanText(body.Prenom, 80);
  if (!nom || !prenom) throw httpError(400, "Le nom et le prénom sont obligatoires");

  const users = await gristAll(env, T_UTILISATEURS);
  const dejaLa = users.some((u) =>
    (u.fields.Nom || "").trim().toLowerCase() === nom.toLowerCase()
    && (u.fields.Prenom || "").trim().toLowerCase() === prenom.toLowerCase());
  if (dejaLa) {
    throw httpError(409, `${prenom} ${nom} a déjà un compte : modifiez-le plutôt que d'en créer un second`);
  }

  const codeAcces = genererCodeAcces();
  const fields = {
    Civilite: CIVILITES.includes(body.Civilite) ? body.Civilite : "",
    Nom: nom,
    Prenom: prenom,
    Telephone: cleanText(body.Telephone, 30),
    Code_acces: codeAcces,
    Utilisateur_de_l_outil: body.Actif !== false,
    Administrateur: body.Administrateur === true,
  };

  // Adresse e-mail : saisie seulement si le document ne la calcule pas.
  const email = cleanText(body.Email, 120).toLowerCase();
  if (email && !(await emailCadreCalcule(env))) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, "Adresse mail invalide");
    if (users.some((u) => (u.fields.Email || "").trim().toLowerCase() === email)) {
      throw httpError(409, "Un compte utilise déjà cette adresse e-mail");
    }
    fields.Email = email;
  }

  const cree = await grist(env, "POST", `/tables/${T_UTILISATEURS}/records`, { records: [{ fields }] });
  const id = cree.records[0].id;
  const nbServices = await rattacherServicesCadre(env, id, body.services);

  if (info) {
    info.detail = `${prenom} ${nom}`
      + (fields.Administrateur ? " (administrateur)" : "")
      + (nbServices ? ` — ${nbServices} service(s) rattaché(s)` : "");
  }
  // Le code d'accès repart une fois vers l'écran qui vient de le créer : c'est
  // le seul moment où l'administrateur peut le copier sans le régénérer.
  return json({ id, Code_acces: codeAcces }, 201);
}

/**
 * L'administrateur modifie un compte cadre : identité, activation, droits
 * d'administration, services rattachés, et les trois actions qui n'existaient
 * jusqu'ici que dans Grist — réinitialiser le PIN, débloquer après des essais
 * manqués, régénérer le code d'accès.
 */
async function modifierCadreAdmin(request, env, admin, cadreId, info) {
  const body = await request.json().catch(() => ({}));
  await ensureColumns(env, T_UTILISATEURS, COLONNES_COMPTE_CADRE);

  const rows = await gristFilter(env, T_UTILISATEURS, { id: [cadreId] });
  if (!rows.length) throw httpError(404, "Ce compte cadre est introuvable");
  const cible = rows[0];
  // Garde-fou : un administrateur ne peut ni se désactiver ni se retirer ses
  // propres droits. Sans elle, une fausse manœuvre fermerait l'espace admin
  // à tout le monde, sans plus aucun moyen de le rouvrir depuis le site.
  const soiMeme = cadreId === admin.rowId;

  const fields = {};
  const faits = [];

  if (body.Civilite !== undefined) {
    fields.Civilite = CIVILITES.includes(body.Civilite) ? body.Civilite : "";
  }
  if (body.Nom !== undefined) {
    const nom = cleanText(body.Nom, 80);
    if (!nom) throw httpError(400, "Le nom est obligatoire");
    fields.Nom = nom;
  }
  if (body.Prenom !== undefined) {
    const prenom = cleanText(body.Prenom, 80);
    if (!prenom) throw httpError(400, "Le prénom est obligatoire");
    fields.Prenom = prenom;
  }
  if (body.Telephone !== undefined) fields.Telephone = cleanText(body.Telephone, 30);
  if (body.Email !== undefined && !(await emailCadreCalcule(env))) {
    const email = cleanText(body.Email, 120).toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, "Adresse mail invalide");
    if (email) {
      const users = await gristAll(env, T_UTILISATEURS);
      if (users.some((u) => u.id !== cadreId && (u.fields.Email || "").trim().toLowerCase() === email)) {
        throw httpError(409, "Un compte utilise déjà cette adresse e-mail");
      }
    }
    fields.Email = email;
  }

  if (body.Actif !== undefined) {
    const actif = body.Actif === true;
    if (!actif && soiMeme) throw httpError(400, "Vous ne pouvez pas désactiver votre propre compte");
    fields.Utilisateur_de_l_outil = actif;
    faits.push(actif ? "compte réactivé" : "compte désactivé");
  }
  if (body.Administrateur !== undefined) {
    const estAdmin = body.Administrateur === true;
    if (!estAdmin && soiMeme) {
      throw httpError(400, "Vous ne pouvez pas retirer vos propres droits d'administration");
    }
    fields.Administrateur = estAdmin;
    faits.push(estAdmin ? "droits d'administration accordés" : "droits d'administration retirés");
  }

  if (body.reinitPin === true) {
    // Le cadre choisira un nouveau PIN à sa prochaine connexion. Le compteur
    // d'essais est remis à zéro : sinon un compte bloqué le resterait.
    fields.Reinit_PIN = true;
    fields.PIN_essais = 0;
    fields.PIN_bloque_jusqu_a = 0;
    faits.push("PIN réinitialisé");
  } else if (body.debloquerPin === true) {
    fields.PIN_essais = 0;
    fields.PIN_bloque_jusqu_a = 0;
    faits.push("compte débloqué");
  }

  let nouveauCode = null;
  if (body.regenererCode === true) {
    nouveauCode = genererCodeAcces();
    fields.Code_acces = nouveauCode;
    faits.push("code d'accès régénéré");
  }

  if (Object.keys(fields).length) {
    await gristUpdate(env, T_UTILISATEURS, cadreId, fields);
  }
  const nbServices = await rattacherServicesCadre(env, cadreId, body.services);
  if (nbServices) faits.push(`${nbServices} service(s) rattaché(s) ou détaché(s)`);

  if (!Object.keys(fields).length && nbServices === null) {
    throw httpError(400, "Aucune modification fournie");
  }

  if (info) {
    info.detail = `${cadreNomComplet(cible)} — ${faits.join(", ") || "identité mise à jour"}`;
  }
  // Toute écriture ci-dessus (code d'accès, PIN, droits) change l'empreinte du
  // compte : les sessions ouvertes de CE cadre tombent d'elles-mêmes.
  return json({ ok: true, ...(nouveauCode ? { Code_acces: nouveauCode } : {}) });
}

/* ------------------------------------------------------------------ */
/* Espace administrateur : les services et les sites                   */
/* ------------------------------------------------------------------ */

/**
 * Schéma réel des pôles, détecté dans le document. La table Pole vient du
 * document d'origine et n'a jamais eu de forme imposée : plutôt que de deviner
 * des noms de colonnes — et de créer des colonnes parasites en cas d'erreur —
 * on lit ce qui existe et on s'y adapte. Renvoie ce qu'on a trouvé, et de quoi
 * l'expliquer à l'administrateur quand il manque quelque chose.
 */
async function schemaOrganisation(env) {
  const schema = {
    poleTable: false, // la table Pole existe
    poleNom: null, // colonne du nom du pôle
    poleCSS: null, // colonne du/des cadre(s) supérieur(s)
    poleCSSListe: false, // CSS est une liste de références
    servicePole: null, // colonne de SERVICES qui pointe vers le pôle
    servicePoleListe: false, // … et c'est une liste de références
  };

  const estTexte = (c) => /^Text$|^Choice$/.test((c.fields && c.fields.type) || "") && !c.fields.isFormula;
  const versUtilisateurs = (c) => /^(Ref|RefList):UTILISATEURS$/.test((c.fields && c.fields.type) || "");
  const versPole = (c) => new RegExp(`^(Ref|RefList):${T_POLE}$`).test((c.fields && c.fields.type) || "");

  try {
    const cols = (await grist(env, "GET", `/tables/${T_POLE}/columns`)).columns || [];
    schema.poleTable = true;
    const parId = new Map(cols.map((c) => [c.id, c]));
    schema.poleNom = ["Nom", "NOM", "Libelle", "Libellé", "Pole", "POLE"]
      .find((id) => parId.has(id) && estTexte(parId.get(id)))
      || (cols.find(estTexte) || {}).id || null;
    const colCSS = ["CSS", "Cadre_sup", "CSS_pole", "Cadre_superieur"]
      .map((id) => parId.get(id)).find((c) => c && versUtilisateurs(c))
      || cols.find(versUtilisateurs);
    if (colCSS) {
      schema.poleCSS = colCSS.id;
      schema.poleCSSListe = /^RefList:/.test(colCSS.fields.type);
    }
  } catch {
    schema.poleTable = false; // table absente : les écrans le diront
  }

  if (schema.poleTable) {
    const svcCols = (await grist(env, "GET", `/tables/${T_SERVICES}/columns`)).columns || [];
    const lien = svcCols.find((c) => versPole(c) && !c.fields.isFormula);
    if (lien) {
      schema.servicePole = lien.id;
      schema.servicePoleListe = /^RefList:/.test(lien.fields.type);
    }
  }
  return schema;
}

/** Valeur à écrire dans une colonne Référence : un nombre, ou ["L", …] pour
 *  une liste. `null`/0 efface le lien. */
function valeurReference(ids, liste) {
  if (liste) return ids.length ? ["L", ...ids] : null;
  return ids.length ? ids[0] : 0;
}

/** Tout ce qu'affichent les écrans Services, Pôles et Organigramme. */
async function listerOrganisationAdmin(env) {
  const schema = await schemaOrganisation(env);
  const [services, sites, users, codes, poles] = await Promise.all([
    gristAll(env, T_SERVICES),
    gristAll(env, T_SITES),
    gristAll(env, T_UTILISATEURS),
    gristAll(env, T_CODES),
    schema.poleTable ? gristAll(env, T_POLE) : Promise.resolve([]),
  ]);
  const sitesById = new Map(sites.map((s) => [s.id, s]));
  const nomPole = (p) => (schema.poleNom ? (p.fields[schema.poleNom] || "") : "") || `Pôle #${p.id}`;
  const polesById = new Map(poles.map((p) => [p.id, p]));

  return {
    schema,
    sites: sites
      .map((s) => ({ id: s.id, NOM: s.fields.NOM || "" }))
      .sort((a, b) => a.NOM.localeCompare(b.NOM, "fr")),
    poles: poles
      .map((p) => ({
        id: p.id,
        Nom: nomPole(p),
        CSS: schema.poleCSS ? refIds(p.fields[schema.poleCSS]) : [],
      }))
      .sort((a, b) => a.Nom.localeCompare(b.Nom, "fr")),
    // TOUS les comptes, actifs ou non. Un référent désactivé (départ, mutation)
    // reste le référent tant qu'on ne l'a pas remplacé : son nom doit
    // s'afficher, et surtout rester dans la liste de la fiche — sinon
    // l'enregistrer effacerait le référent sans le dire. Le front ne propose
    // que les comptes actifs, plus celui déjà en place.
    cadres: users
      .map((u) => ({
        id: u.id,
        nom: cadreNomComplet(u),
        telephone: u.fields.Telephone || "",
        email: (u.fields.Email || "").trim(),
        actif: u.fields.Utilisateur_de_l_outil === true,
      }))
      .sort((a, b) => a.nom.localeCompare(b.nom, "fr")),
    codes: codes
      .map((c) => ({
        id: c.id,
        Code: c.fields.Code || "",
        Libelle: c.fields.Libelle || "",
        Heure_debut: c.fields.Heure_debut || "",
        Heure_fin: c.fields.Heure_fin || "",
        Compte_stage: c.fields.Compte_stage !== false,
      }))
      .sort((a, b) => a.Code.localeCompare(b.Code, "fr")),
    services: services.map((s) => {
      const poleId = schema.servicePole ? (refIds(s.fields[schema.servicePole])[0] || null) : null;
      return {
        id: s.id,
        Nom: s.fields.Nom || "",
        Code_UF: s.fields.Code_UF || "",
        // L'écran a besoin de l'identifiant du site pour le modifier, et de son
        // nom pour l'afficher : les deux sont renvoyés.
        SiteId: s.fields.Site || null,
        Site: siteName(s, sitesById),
        PoleId: poleId,
        Pole: poleId && polesById.has(poleId) ? nomPole(polesById.get(poleId)) : "",
        Cadre_ref: s.fields.Cadre_ref || null,
        Cadres_secondaires: refIds(s.fields.Cadres_secondaires),
        Pole_CSS: refIds(s.fields.Pole_CSS),
        Recoit_des_etudiant: !!s.fields.Recoit_des_etudiant,
        // Codes horaires actifs du service ; liste vide = tous les codes.
        Codes: refIds(s.fields.Codes_horaires),
      };
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Espace administrateur : dossiers des étudiants                      */
/* ------------------------------------------------------------------ */

/** Nom d'un service pour l'affichage (« Nom (Site) »), ou "" si absent. */
function nomServiceAvecSite(service, sitesById) {
  if (!service) return "";
  const site = siteName(service, sitesById);
  return site ? `${service.fields.Nom || ""} (${site})` : (service.fields.Nom || "");
}

/**
 * Écran « Étudiants » de l'espace admin : un dossier par étudiant, tous
 * services confondus (contrairement à l'espace cadre, borné aux services du
 * cadre connecté). Résumé seulement — le détail (périodes, sorties, rdv,
 * journal) est chargé à la demande par ficheEtudiantAdmin, pour ne pas
 * ramener tout l'historique de tous les étudiants à chaque ouverture de l'écran.
 */
async function listerEtudiantsAdmin(env) {
  const [students, periodesAll, servicesAll, sites] = await Promise.all([
    gristAll(env, T_ETUDIANTS),
    gristAll(env, T_PERIODES),
    gristAll(env, T_SERVICES),
    gristAll(env, T_SITES),
  ]);
  const servicesById = new Map(servicesAll.map((s) => [s.id, s]));
  const sitesById = new Map(sites.map((s) => [s.id, s]));

  const periodesParEtudiant = new Map();
  for (const p of periodesAll) {
    const id = p.fields.Etudiant;
    if (!id) continue;
    if (!periodesParEtudiant.has(id)) periodesParEtudiant.set(id, []);
    periodesParEtudiant.get(id).push(p);
  }

  return {
    formations: FORMATIONS,
    civilites: CIVILITES,
    etudiants: students.map((e) => {
      const periodes = (periodesParEtudiant.get(e.id) || [])
        .slice()
        .sort((a, b) => (b.fields.Du || 0) - (a.fields.Du || 0));
      const enCours = periodes.find((p) => p.fields.En_cours) || null;
      const dernier = enCours || periodes[0] || null;
      const service = dernier ? servicesById.get(dernier.fields.Service) : null;
      return {
        id: e.id,
        nom: e.fields.NOM || "",
        prenom: e.fields.PRENOM || "",
        anonymat: e.fields.Anonymat || "",
        formation: e.fields.FORMATION || "",
        centre: e.fields.Centre_de_formation || "",
        email: e.fields.Adresse_mail || "",
        telephone: e.fields.Numero_de_telephone || "",
        niveau: dernier ? dernier.fields.Niveau || "" : "",
        nbPeriodes: periodes.length,
        enCours: !!enCours,
        service_actuel: nomServiceAvecSite(service, sitesById),
        dernier_du: dernier ? epochToIso(dernier.fields.Du) : null,
        dernier_au: dernier ? epochToIso(dernier.fields.Au) : null,
      };
    }),
  };
}

/**
 * Dossier complet d'un étudiant : identité, historique de TOUTES ses périodes
 * de stage (tous services, contrairement à l'espace cadre), ses déclarations
 * de sorties, ses rendez-vous formateur et les dernières lignes du journal
 * d'activité qui le concernent (connexions, consultations de son dossier).
 */
async function ficheEtudiantAdmin(env, etudiantId) {
  const students = await gristFilter(env, T_ETUDIANTS, { id: [etudiantId] });
  if (!students.length) throw httpError(404, "Dossier étudiant introuvable");
  const student = students[0];

  const [periodes, servicesAll, sites, users, evaluations, sorties, rdvsAll, commentaires] = await Promise.all([
    gristFilter(env, T_PERIODES, { Etudiant: [etudiantId] }),
    gristAll(env, T_SERVICES),
    gristAll(env, T_SITES),
    gristAll(env, T_UTILISATEURS),
    gristAll(env, T_EVALUATIONS),
    gristFilter(env, T_SORTIES, { Anonymat: [etudiantId] }),
    gristAll(env, T_RDV),
    gristAll(env, T_COMMENTAIRES),
  ]);

  // Bilan final : reconnu parmi les commentaires/pièces jointes de chaque
  // période par son texte (voir MOTIF_BILAN) — pas de colonne dédiée.
  const periodesAvecBilan = new Set(
    commentaires.filter((c) => MOTIF_BILAN.test(c.fields.Commentaire || "")).map((c) => c.fields.Periode_de_stage)
  );

  const servicesById = new Map(servicesAll.map((s) => [s.id, s]));
  const sitesById = new Map(sites.map((s) => [s.id, s]));
  const usersById = new Map(users.map((u) => [u.id, u]));

  // Évaluation répondue : cf. buildCadrePayload — lien par UUID de la période,
  // avec repli sur la référence directe Periode_de_stage.
  const periodeIdByUuid = new Map(periodes.map((p) => [p.fields.UUID, p.id]).filter(([uuid]) => uuid));
  const periodesAvecReponse = new Set();
  for (const e of evaluations) {
    const periodeId = (e.fields.Cle_lien && periodeIdByUuid.get(e.fields.Cle_lien))
      || e.fields.Periode_de_stage || null;
    if (periodeId) periodesAvecReponse.add(periodeId);
  }

  const periodeIdSet = new Set(periodes.map((p) => p.id));
  const rdvs = rdvsAll.filter((r) => periodeIdSet.has(r.fields.Periode));

  const nomComplet = nomCompletEtudiant(student);
  // Best-effort : un journal indisponible (colonne pas encore créée, Grist en
  // défaut) ne doit pas empêcher d'afficher le reste du dossier.
  const journalBrut = nomComplet
    ? await gristFilter(env, T_JOURNAL, { Etudiant: [nomComplet] }).catch(() => [])
    : [];

  return {
    etudiant: {
      id: student.id,
      nom: student.fields.NOM || "",
      prenom: student.fields.PRENOM || "",
      civilite: student.fields.Civilite || "",
      anonymat: student.fields.Anonymat || "",
      formation: student.fields.FORMATION || "",
      centre: student.fields.Centre_de_formation || "",
      email: student.fields.Adresse_mail || "",
      telephone: student.fields.Numero_de_telephone || "",
      ddn: epochToIso(student.fields.DDN),
    },
    periodes: periodes
      .slice()
      .sort((a, b) => (b.fields.Du || 0) - (a.fields.Du || 0))
      .map((p) => {
        const svc = servicesById.get(p.fields.Service);
        const fait = p.fields.FAIT ?? 0;
        const aFaire = p.fields.A_FAIRE ?? 0;
        return {
          id: p.id,
          Service_nom: (svc && svc.fields.Nom) || "",
          Site: svc ? siteName(svc, sitesById) : "",
          Du: epochToIso(p.fields.Du),
          Au: epochToIso(p.fields.Au),
          Niveau: p.fields.Niveau || "",
          Tuteur: p.fields.Tuteur || "",
          Referent_pedagogique: p.fields.Referent_pedagogique || "",
          En_cours: !!p.fields.En_cours,
          A_FAIRE: aFaire,
          FAIT: fait,
          Solde_heures: Math.round((fait - aFaire) * 100) / 100,
          Lien_evaluation: p.fields.Lien_evaluation || "",
          Evaluation_envoyee: !!p.fields.Evaluation_envoyee,
          Evaluation_repondue: periodesAvecReponse.has(p.id),
          Bilan_final: periodesAvecBilan.has(p.id),
          cadre: cadreInfo(svc, usersById),
        };
      }),
    sorties: sorties
      .slice()
      .sort((a, b) => (b.fields.Date || 0) - (a.fields.Date || 0))
      .map((s) => ({
        id: s.id,
        Periode: s.fields.Pour_le_stage_du_ || s.fields.Rapprochement_manuel || null,
        Motif: s.fields.Motif || "",
        Commentaire: s.fields.Motif_ou_Commentaire || "",
        Date: epochToIso(s.fields.Date),
        Heure_debut: s.fields.Heure_debut || "",
        Heure_fin: s.fields.Heure_fin || "",
        Compte_stage: !!s.fields.Compte_stage,
        Valide: !!s.fields.Valide,
        Duree_heures: s.fields.Duree_heures ?? 0,
        Ajustement_h: s.fields.Ajustement_h ?? 0,
      })),
    rdvs: rdvs
      .slice()
      .sort((a, b) => (b.fields.Date_rdv || 0) - (a.fields.Date_rdv || 0))
      .map((r) => ({
        id: r.id,
        Date_rdv: epochToIso(r.fields.Date_rdv),
        Type_de_rendez_vous: r.fields.Type_de_rendez_vous || "",
        Formateur: r.fields.Formateur || "",
        Commentaire: r.fields.Commentaire || "",
      })),
    // Journal : les 100 lignes les plus récentes concernant cet étudiant
    // (connexions, consultations de son dossier par un cadre ou un admin).
    // La colonne JOURNAL_ACTIVITE.Etudiant est un texte (nom complet) — même
    // limite que le reste du journal (voir logActivite) : un homonyme exact
    // mélangerait les deux dossiers.
    journal: journalBrut
      .slice()
      .sort((a, b) => (b.fields.Horodatage || 0) - (a.fields.Horodatage || 0))
      .slice(0, 100)
      .map((j) => ({
        id: j.id,
        Horodatage: j.fields.Horodatage || null,
        Role: j.fields.Role || "",
        Qui: j.fields.Qui || "",
        Action: j.fields.Action || "",
        Detail: j.fields.Detail || "",
        Service: j.fields.Service || "",
        Site: j.fields.Site || "",
      })),
  };
}

/**
 * L'administrateur modifie l'identité d'un étudiant (formulaire de la fiche).
 * Nom/prénom/date de naissance servent au calcul du code anonymat — le
 * véritable code de connexion de l'étudiant — donc un changement de l'un de
 * ces trois champs le recalcule (même formule qu'à l'inscription), avec un
 * contrôle anti-collision, puis le reporte sur Code_anonymat de chacun de ses
 * stages (dénormalisé, lu par la connexion étudiant).
 */
async function modifierEtudiantAdmin(request, env, etudiantId, info) {
  const rows = await gristFilter(env, T_ETUDIANTS, { id: [etudiantId] });
  if (!rows.length) throw httpError(404, "Dossier étudiant introuvable");
  const etu = rows[0];

  const body = await request.json().catch(() => ({}));
  const identiteChangee = body.NOM !== undefined || body.PRENOM !== undefined || body.DDN !== undefined;
  const nom = body.NOM !== undefined ? cleanText(body.NOM, 80) : (etu.fields.NOM || "");
  const prenom = body.PRENOM !== undefined ? cleanText(body.PRENOM, 80) : (etu.fields.PRENOM || "");
  const ddnEpoch = body.DDN !== undefined ? exigerDate(body.DDN, "Date de naissance") : etu.fields.DDN;

  const fields = {};
  if (identiteChangee) {
    if (!nom || !prenom) throw httpError(400, "Nom et prénom obligatoires");
    fields.NOM = nom;
    fields.PRENOM = prenom;
    fields.DDN = ddnEpoch;
  }
  if (body.Civilite !== undefined) fields.Civilite = CIVILITES.includes(body.Civilite) ? body.Civilite : "";
  if (body.FORMATION !== undefined) {
    if (body.FORMATION && !FORMATIONS.includes(body.FORMATION)) throw httpError(400, "Formation invalide");
    fields.FORMATION = body.FORMATION || "";
  }
  if (body.Centre_de_formation !== undefined) fields.Centre_de_formation = cleanText(body.Centre_de_formation, 120);
  if (body.Adresse_mail !== undefined) {
    const email = cleanText(body.Adresse_mail, 120);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, "Adresse mail invalide");
    fields.Adresse_mail = email;
  }
  if (body.Numero_de_telephone !== undefined) fields.Numero_de_telephone = cleanText(body.Numero_de_telephone, 20);
  if (!Object.keys(fields).length) throw httpError(400, "Aucune modification fournie");

  if (identiteChangee) {
    const iso = epochToIso(ddnEpoch);
    const [y, mo, d] = (iso || "").split("-");
    const nouveauCode = y && mo && d ? (prenom[0] + d + mo + y.slice(2) + nom[0]).toUpperCase() : "";
    if (nouveauCode && nouveauCode !== (etu.fields.Anonymat || "")) {
      const collisions = await gristFilter(env, T_ETUDIANTS, { Anonymat: [nouveauCode] });
      if (collisions.some((c) => c.id !== etudiantId)) {
        throw httpError(409, "Un autre dossier utilise déjà ce code (mêmes initiales et même date de naissance).");
      }
      fields.Anonymat = nouveauCode;
    }
  }

  await gristUpdate(env, T_ETUDIANTS, etudiantId, fields);

  if (fields.Anonymat) {
    const periodes = await gristFilter(env, T_PERIODES, { Etudiant: [etudiantId] });
    await Promise.all(periodes.map((p) =>
      gristUpdate(env, T_PERIODES, p.id, { Code_anonymat: fields.Anonymat })));
  }

  if (info) {
    info.etudiantId = etudiantId;
    info.detail = Object.keys(fields).join(", ") + (fields.Anonymat ? " (code recalculé)" : "");
  }
  return json((await ficheEtudiantAdmin(env, etudiantId)).etudiant);
}

/**
 * Fusionne un ou plusieurs dossiers étudiant en doublon (même personne créée
 * plusieurs fois) dans un seul dossier conservé : ses stages (PERIODES_DE_STAGE)
 * et ses déclarations de sortie (Sortie_de_stage) sont rattachés au dossier
 * conservé, les champs d'identité vides du dossier conservé sont complétés
 * depuis les doublons, puis les doublons sont supprimés. Le reste de
 * l'historique (planning, rendez-vous, évaluations) suit automatiquement : il
 * est rattaché aux périodes de stage, pas directement à l'étudiant.
 */
async function fusionnerEtudiantsAdmin(request, env, info) {
  const body = await request.json().catch(() => ({}));
  const garderId = Number(body.garderId) || 0;
  const fusionnerIds = idsValides(body.fusionnerIds).filter((id) => id !== garderId);
  if (!garderId) throw httpError(400, "Dossier à conserver manquant");
  if (!fusionnerIds.length) throw httpError(400, "Aucun dossier à fusionner");

  const rows = await gristFilter(env, T_ETUDIANTS, { id: [garderId, ...fusionnerIds] });
  const parId = new Map(rows.map((r) => [r.id, r]));
  const cible = parId.get(garderId);
  if (!cible) throw httpError(404, "Dossier à conserver introuvable");
  for (const id of fusionnerIds) {
    if (!parId.get(id)) throw httpError(404, `Dossier ${id} introuvable`);
  }

  // Complète l'identité du dossier conservé avec les champs qu'il n'a pas,
  // à partir des doublons (le premier doublon qui a la donnée gagne).
  const champsIdentite = ["Civilite", "FORMATION", "Centre_de_formation", "Adresse_mail", "Numero_de_telephone"];
  const fieldsAjout = {};
  for (const champ of champsIdentite) {
    if (cible.fields[champ]) continue;
    for (const id of fusionnerIds) {
      const v = parId.get(id).fields[champ];
      if (v) { fieldsAjout[champ] = v; break; }
    }
  }
  if (Object.keys(fieldsAjout).length) await gristUpdate(env, T_ETUDIANTS, garderId, fieldsAjout);

  const [periodes, sorties] = await Promise.all([
    gristFilter(env, T_PERIODES, { Etudiant: fusionnerIds }),
    gristFilter(env, T_SORTIES, { Anonymat: fusionnerIds }),
  ]);
  const codeCible = cible.fields.Anonymat || "";
  await Promise.all([
    ...periodes.map((p) => gristUpdate(env, T_PERIODES, p.id,
      { Etudiant: garderId, ...(codeCible ? { Code_anonymat: codeCible } : {}) })),
    ...sorties.map((s) => gristUpdate(env, T_SORTIES, s.id, { Anonymat: garderId })),
  ]);

  // Les doublons disparaissent : leur historique vit désormais sous le
  // dossier conservé, les garder ne ferait que semer la confusion.
  await grist(env, "POST", `/tables/${T_ETUDIANTS}/data/delete`, fusionnerIds);

  if (info) {
    info.etudiantId = garderId;
    info.detail = `${fusionnerIds.length} dossier(s) fusionné(s) dans « ${nomCompletEtudiant(cible)} » — `
      + `${periodes.length} stage(s), ${sorties.length} sortie(s) rattachés`;
  }
  return json({ ok: true, etudiantId: garderId, periodesDeplacees: periodes.length, sortiesDeplacees: sorties.length });
}

/** Vérifie qu'une période de stage appartient bien à cet étudiant (pas à un
 *  autre dossier) avant d'en toucher le bilan final — utilisé côté admin,
 *  qui voit tous les dossiers. Le cadre, lui, passe par ensurePeriodeInScope
 *  (bornée à ses propres services). */
async function periodeDeLEtudiant(env, etudiantId, periodeId) {
  const rows = await gristFilter(env, T_PERIODES, { id: [periodeId] });
  const periode = rows[0];
  if (!periode || periode.fields.Etudiant !== etudiantId) {
    throw httpError(404, "Période de stage introuvable pour ce dossier étudiant");
  }
  return periode;
}

const TYPES_BILAN_AUTORISES = ["application/pdf", "image/png", "image/jpeg"];
/** Motif reconnaissant "le" bilan final parmi les autres commentaires/pièces
 *  jointes d'une période (feuille de présence, etc.) : son Commentaire
 *  contient "bilan", qu'il ait été déposé à la main dans Grist (ex.
 *  "BARILLE_Yannick_Bilan_Final.pdf") ou via le site (voir deposerBilan). */
const MOTIF_BILAN = /bilan/i;

/** Toutes les lignes BDD_COM reconnues comme "bilan" pour une période, triées
 *  de la plus récente à la plus ancienne. */
async function bilansDeLaPeriode(env, periodeId) {
  const rows = await gristFilter(env, T_COMMENTAIRES, { Periode_de_stage: [periodeId] });
  return rows
    .filter((r) => MOTIF_BILAN.test(r.fields.Commentaire || ""))
    .sort((a, b) => (b.fields.Cree_le || 0) - (a.fields.Cree_le || 0));
}

/**
 * Dépose le bilan final d'un stage (multipart/form-data, champ "bilan") : PDF
 * ou image, en nouvelle ligne de BDD_COM (table de commentaires/pièces
 * jointes par période déjà utilisée à la main dans Grist). Commun à l'espace
 * admin (n'importe quel dossier) et à l'espace cadre (périodes de ses propres
 * services) : seule la vérification d'accès en amont diffère
 * (periodeDeLEtudiant / ensurePeriodeInScope).
 */
async function deposerBilan(request, env, periode, info) {
  const form = await request.formData().catch(() => null);
  const file = form ? form.get("bilan") : null;
  if (!file || typeof file === "string") throw httpError(400, "Fichier manquant");
  if (file.size > 10 * 1024 * 1024) throw httpError(400, "Fichier trop lourd (10 Mo maximum)");
  if (file.type && !TYPES_BILAN_AUTORISES.includes(file.type)) {
    throw httpError(400, "Le bilan doit être un PDF ou une image (JPEG/PNG)");
  }

  const attId = await envoyerPieceJointeGrist(env, file, "bilan-de-stage");
  await grist(env, "POST", `/tables/${T_COMMENTAIRES}/records`, {
    records: [{ fields: {
      Periode_de_stage: periode.id,
      Commentaire: "Bilan final de stage",
      Piece_jointe: ["L", attId],
    } }],
  });

  if (info) {
    info.etudiantId = periode.fields.Etudiant;
    info.serviceId = periode.fields.Service;
    info.detail = `${file.name || "bilan"} — stage du ${jDateEpoch(periode.fields.Du)}`;
  }
  return json({ ok: true });
}

/** Retire le(s) bilan(s) d'un stage : supprime la ou les lignes BDD_COM
 *  reconnues comme telles (la pièce jointe reste dans le document Grist,
 *  seule la ligne qui la référence disparaît — même logique que le logo). */
async function retirerBilan(env, periode, info) {
  const bilans = await bilansDeLaPeriode(env, periode.id);
  if (bilans.length) await grist(env, "POST", `/tables/${T_COMMENTAIRES}/data/delete`, bilans.map((b) => b.id));
  if (info) {
    info.etudiantId = periode.fields.Etudiant;
    info.serviceId = periode.fields.Service;
    info.detail = `stage du ${jDateEpoch(periode.fields.Du)}`;
  }
  return json({ ok: true });
}

/** Proxifie le téléchargement du bilan le plus récent d'un stage (la clé API
 *  Grist reste côté Worker, jamais exposée au navigateur). */
async function telechargerBilan(env, periode) {
  const bilans = await bilansDeLaPeriode(env, periode.id);
  const attId = bilans.length ? premierePieceJointe(bilans[0].fields.Piece_jointe) : null;
  if (!attId) throw httpError(404, "Aucun bilan pour ce stage");

  const base = (env.GRIST_BASE_URL || "https://grist.numerique.gouv.fr/api").replace(/\/$/, "");
  const res = await fetch(`${base}/docs/${env.GRIST_DOC_ID}/attachments/${attId}/download`, {
    headers: { Authorization: `Bearer ${env.GRIST_API_KEY}` },
  });
  if (!res.ok) throw httpError(404, "Bilan introuvable");
  return new Response(res.body, {
    headers: { "Content-Type": res.headers.get("Content-Type") || "application/octet-stream" },
  });
}

/* ------------------------------------------------------------------ */
/* Commentaires et pièces jointes d'un stage (table BDD_COM)           */
/* ------------------------------------------------------------------ */

/** Tous les commentaires/pièces jointes d'une période, du plus récent au plus
 *  ancien. Le bilan final en fait partie (voir MOTIF_BILAN). */
async function listerCommentaires(env, periode) {
  const rows = await gristFilter(env, T_COMMENTAIRES, { Periode_de_stage: [periode.id] });
  return json({
    commentaires: rows
      .slice()
      .sort((a, b) => (b.fields.Cree_le || 0) - (a.fields.Cree_le || 0))
      .map((r) => ({
        id: r.id,
        commentaire: r.fields.Commentaire || "",
        fichier: !!premierePieceJointe(r.fields.Piece_jointe),
        creeLe: r.fields.Cree_le || null,
        creePar: r.fields.Cree_par || "",
        estBilan: MOTIF_BILAN.test(r.fields.Commentaire || ""),
      })),
  });
}

/** Ajoute un commentaire sur un stage, avec pièce jointe facultative
 *  (multipart/form-data : champ texte "commentaire", champ fichier "fichier"). */
async function ajouterCommentaire(request, env, periode, info) {
  const form = await request.formData().catch(() => null);
  if (!form) throw httpError(400, "Requête invalide");
  const texte = cleanText(form.get("commentaire"), 500);
  const file = form.get("fichier");
  const aFichier = file && typeof file !== "string";
  if (!texte && !aFichier) throw httpError(400, "Ajoutez un commentaire ou un fichier");

  const fields = { Periode_de_stage: periode.id, Commentaire: texte };
  if (aFichier) {
    if (file.size > 10 * 1024 * 1024) throw httpError(400, "Fichier trop lourd (10 Mo maximum)");
    if (file.type && !TYPES_BILAN_AUTORISES.includes(file.type)) {
      throw httpError(400, "Le fichier doit être un PDF ou une image (JPEG/PNG)");
    }
    fields.Piece_jointe = ["L", await envoyerPieceJointeGrist(env, file, "document")];
  }
  await grist(env, "POST", `/tables/${T_COMMENTAIRES}/records`, { records: [{ fields }] });

  if (info) {
    info.etudiantId = periode.fields.Etudiant;
    info.serviceId = periode.fields.Service;
    info.detail = (texte || (aFichier ? file.name : "")) + ` — stage du ${jDateEpoch(periode.fields.Du)}`;
  }
  return json({ ok: true });
}

/** Vérifie qu'un commentaire relève bien d'une période accessible au cadre,
 *  et renvoie la ligne BDD_COM correspondante. */
async function commentaireDuCadre(env, cadre, commentaireId) {
  const rows = await gristFilter(env, T_COMMENTAIRES, { id: [commentaireId] });
  if (!rows.length) throw httpError(404, "Commentaire introuvable");
  await ensurePeriodeInScope(env, cadre, rows[0].fields.Periode_de_stage);
  return rows[0];
}

/** Proxifie le téléchargement de la pièce jointe d'un commentaire. */
async function telechargerFichierCommentaire(env, commentaire) {
  const attId = premierePieceJointe(commentaire.fields.Piece_jointe);
  if (!attId) throw httpError(404, "Ce commentaire n'a pas de pièce jointe");

  const base = (env.GRIST_BASE_URL || "https://grist.numerique.gouv.fr/api").replace(/\/$/, "");
  const res = await fetch(`${base}/docs/${env.GRIST_DOC_ID}/attachments/${attId}/download`, {
    headers: { Authorization: `Bearer ${env.GRIST_API_KEY}` },
  });
  if (!res.ok) throw httpError(404, "Fichier introuvable");
  return new Response(res.body, {
    headers: { "Content-Type": res.headers.get("Content-Type") || "application/octet-stream" },
  });
}

/** Supprime un commentaire (la pièce jointe reste dans le document Grist). */
async function supprimerCommentaire(env, commentaire, info) {
  await grist(env, "POST", `/tables/${T_COMMENTAIRES}/data/delete`, [commentaire.id]);
  if (info) info.detail = commentaire.fields.Commentaire || "(sans texte)";
  return json({ ok: true });
}

/** L'administrateur crée un pôle. */
async function creerPoleAdmin(request, env, info) {
  const body = await request.json().catch(() => ({}));
  const schema = await schemaOrganisation(env);
  if (!schema.poleTable) throw httpError(400, "Ce document n'a pas de table « Pole »");
  if (!schema.poleNom) throw httpError(400, "La table « Pole » n'a pas de colonne de nom exploitable");

  const nom = cleanText(body.Nom, 80);
  if (!nom) throw httpError(400, "Le nom du pôle est obligatoire");
  const poles = await gristAll(env, T_POLE);
  if (poles.some((p) => (p.fields[schema.poleNom] || "").trim().toLowerCase() === nom.toLowerCase())) {
    throw httpError(409, `Le pôle « ${nom} » existe déjà`);
  }

  const fields = { [schema.poleNom]: nom };
  if (schema.poleCSS && Array.isArray(body.CSS)) {
    fields[schema.poleCSS] = valeurReference(idsValides(body.CSS), schema.poleCSSListe);
  }
  const cree = await grist(env, "POST", `/tables/${T_POLE}/records`, { records: [{ fields }] });
  if (info) info.detail = nom;
  return json({ id: cree.records[0].id }, 201);
}

/** L'administrateur renomme un pôle ou en change le(s) cadre(s) supérieur(s). */
async function modifierPoleAdmin(request, env, poleId, info) {
  const body = await request.json().catch(() => ({}));
  const schema = await schemaOrganisation(env);
  if (!schema.poleTable) throw httpError(400, "Ce document n'a pas de table « Pole »");

  const poles = await gristAll(env, T_POLE);
  const cible = poles.find((p) => p.id === poleId);
  if (!cible) throw httpError(404, "Ce pôle est introuvable");

  const fields = {};
  const faits = [];
  if (body.Nom !== undefined) {
    if (!schema.poleNom) throw httpError(400, "La table « Pole » n'a pas de colonne de nom exploitable");
    const nom = cleanText(body.Nom, 80);
    if (!nom) throw httpError(400, "Le nom du pôle est obligatoire");
    if (poles.some((p) => p.id !== poleId
      && (p.fields[schema.poleNom] || "").trim().toLowerCase() === nom.toLowerCase())) {
      throw httpError(409, `Le pôle « ${nom} » existe déjà`);
    }
    fields[schema.poleNom] = nom;
    faits.push(`renommé « ${nom} »`);
  }
  if (body.CSS !== undefined) {
    if (!schema.poleCSS) throw httpError(400, "La table « Pole » n'a pas de colonne de cadre supérieur");
    const ids = idsValides(body.CSS);
    if (!schema.poleCSSListe && ids.length > 1) {
      throw httpError(400, "Ce document n'accepte qu'un seul cadre supérieur par pôle");
    }
    fields[schema.poleCSS] = valeurReference(ids, schema.poleCSSListe);
    faits.push(ids.length ? `${ids.length} cadre(s) supérieur(s)` : "cadre supérieur retiré");
  }
  if (!Object.keys(fields).length) throw httpError(400, "Aucune modification fournie");

  await gristUpdate(env, T_POLE, poleId, fields);
  if (info) {
    const nom = schema.poleNom ? (cible.fields[schema.poleNom] || `pôle #${poleId}`) : `pôle #${poleId}`;
    info.detail = `${nom} — ${faits.join(", ")}`;
  }
  return json({ ok: true });
}

/** Identifiants de lignes valides dans une liste envoyée par le front. */
function idsValides(valeurs) {
  if (!Array.isArray(valeurs)) return [];
  return [...new Set(valeurs.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
}

/** Champs d'un service lus depuis une requête. `partiel` : ne garde que les
 *  clés réellement fournies (modification), sinon impose les valeurs par
 *  défaut (création). Le pôle n'est écrit que si le document a bien une
 *  colonne pour ça (voir schemaOrganisation). */
function champsService(body, partiel, schema) {
  const fields = {};
  if (body.PoleId !== undefined && schema && schema.servicePole) {
    fields[schema.servicePole] = valeurReference(idsValides([body.PoleId]), schema.servicePoleListe);
  }
  if (body.Codes !== undefined) {
    // Liste vide = tous les codes horaires (même convention que l'espace cadre).
    const ids = idsValides(body.Codes);
    fields.Codes_horaires = ids.length ? ["L", ...ids] : null;
  }
  if (!partiel || body.Nom !== undefined) {
    const nom = cleanText(body.Nom, 80);
    if (!nom) throw httpError(400, "Le nom du service est obligatoire");
    fields.Nom = nom;
  }
  if (!partiel || body.Code_UF !== undefined) fields.Code_UF = cleanText(body.Code_UF, 30);
  if (!partiel || body.SiteId !== undefined) {
    const siteId = Number(body.SiteId);
    fields.Site = Number.isInteger(siteId) && siteId > 0 ? siteId : 0;
  }
  if (!partiel || body.Cadre_ref !== undefined) {
    const refId = Number(body.Cadre_ref);
    fields.Cadre_ref = Number.isInteger(refId) && refId > 0 ? refId : 0;
  }
  if (!partiel || body.Recoit_des_etudiant !== undefined) {
    fields.Recoit_des_etudiant = body.Recoit_des_etudiant === true;
  }
  return fields;
}

/** Refuse une liste de codes horaires qui ne correspond à rien : un id fantôme
 *  écrit dans SERVICES.Codes_horaires viderait la palette du service. */
async function verifierCodesHoraires(env, demandes) {
  const ids = idsValides(demandes);
  if (!ids.length) return;
  const codes = await gristFilter(env, T_CODES, { id: ids });
  if (codes.length !== ids.length) throw httpError(400, "Code horaire introuvable");
}

/** Refuse deux services de même nom sur un même site (ils seraient
 *  indiscernables dans tous les écrans, à commencer par l'inscription). */
function verifierServiceUnique(services, nom, siteId, sauf) {
  const doublon = services.some((s) =>
    s.id !== sauf
    && (s.fields.Nom || "").trim().toLowerCase() === nom.trim().toLowerCase()
    && (s.fields.Site || 0) === (siteId || 0));
  if (doublon) {
    throw httpError(409, `Un service « ${nom} » existe déjà sur ce site`);
  }
}

/** L'administrateur crée un service. */
async function creerServiceAdmin(request, env, info) {
  const body = await request.json().catch(() => ({}));
  const schema = await schemaOrganisation(env);
  const fields = champsService(body, false, schema);
  const services = await gristAll(env, T_SERVICES);
  verifierServiceUnique(services, fields.Nom, fields.Site, null);
  await verifierCodesHoraires(env, body.Codes);

  const cree = await grist(env, "POST", `/tables/${T_SERVICES}/records`, { records: [{ fields }] });
  const id = cree.records[0].id;
  if (info) {
    info.serviceId = id;
    info.detail = `${fields.Nom}${fields.Code_UF ? ` (${fields.Code_UF})` : ""}`
      + (fields.Recoit_des_etudiant ? " — accueille des étudiants" : " — sans accueil d'étudiants");
  }
  return json({ id }, 201);
}

/** L'administrateur modifie un service. */
async function modifierServiceAdmin(request, env, serviceId, info) {
  const body = await request.json().catch(() => ({}));
  const schema = await schemaOrganisation(env);
  const services = await gristAll(env, T_SERVICES);
  const cible = services.find((s) => s.id === serviceId);
  if (!cible) throw httpError(404, "Ce service est introuvable");

  const fields = champsService(body, true, schema);
  if (!Object.keys(fields).length) throw httpError(400, "Aucune modification fournie");
  await verifierCodesHoraires(env, body.Codes);
  verifierServiceUnique(
    services,
    fields.Nom !== undefined ? fields.Nom : (cible.fields.Nom || ""),
    fields.Site !== undefined ? fields.Site : (cible.fields.Site || 0),
    serviceId);

  await gristUpdate(env, T_SERVICES, serviceId, fields);
  if (info) {
    info.serviceId = serviceId;
    const faits = [];
    if (fields.Nom !== undefined && fields.Nom !== cible.fields.Nom) faits.push(`renommé « ${fields.Nom} »`);
    if (fields.Site !== undefined && fields.Site !== (cible.fields.Site || 0)) faits.push("site changé");
    if (fields.Cadre_ref !== undefined && fields.Cadre_ref !== (cible.fields.Cadre_ref || 0)) faits.push("référent changé");
    if (schema.servicePole && fields[schema.servicePole] !== undefined) faits.push("pôle changé");
    if (fields.Codes_horaires !== undefined) {
      const n = idsValides(body.Codes).length;
      faits.push(n ? `${n} code(s) horaire(s) actifs` : "tous les codes horaires");
    }
    if (fields.Recoit_des_etudiant !== undefined
      && fields.Recoit_des_etudiant !== !!cible.fields.Recoit_des_etudiant) {
      faits.push(fields.Recoit_des_etudiant ? "ouvert aux étudiants" : "fermé aux étudiants");
    }
    info.detail = `${cible.fields.Nom || `service #${serviceId}`} — ${faits.join(", ") || "fiche mise à jour"}`;
  }
  return json({ ok: true });
}

/** L'administrateur crée un site (table SITES, colonne NOM). */
async function creerSiteAdmin(request, env, info) {
  const body = await request.json().catch(() => ({}));
  const nom = cleanText(body.NOM, 80);
  if (!nom) throw httpError(400, "Le nom du site est obligatoire");

  const sites = await gristAll(env, T_SITES);
  if (sites.some((s) => (s.fields.NOM || "").trim().toLowerCase() === nom.toLowerCase())) {
    throw httpError(409, `Le site « ${nom} » existe déjà`);
  }
  const cree = await grist(env, "POST", `/tables/${T_SITES}/records`, { records: [{ fields: { NOM: nom } }] });
  if (info) info.detail = nom;
  return json({ id: cree.records[0].id, NOM: nom }, 201);
}

/** Le cadre change son code PIN. Le PIN actuel est exigé s'il en existe déjà un. */
async function changePin(request, env, cadre, info) {
  const body = await request.json().catch(() => ({}));
  const current = typeof body.currentPin === "string" ? body.currentPin.trim() : "";
  const next = typeof body.newPin === "string" ? body.newPin.trim() : "";
  const stored = (cadre.fields.PIN_hash || "").trim();
  if (stored && !(await verifyPin(current, stored))) {
    throw httpError(401, "Code PIN actuel incorrect");
  }
  if (!/^\d{4,6}$/.test(next)) {
    throw httpError(400, "Le nouveau PIN doit comporter 4 à 6 chiffres");
  }
  await ensureColumn(env, T_UTILISATEURS, "PIN_hash", "PIN (haché)");
  const fields = { PIN_hash: await hashPin(next) };
  await gristUpdate(env, T_UTILISATEURS, cadre.rowId, fields);
  if (info) info.detail = "PIN modifié";
  // Changer le PIN change l'empreinte du compte, donc invalide le jeton en
  // cours (et ceux d'éventuelles autres sessions) : on en délivre un nouveau
  // pour que le cadre reste connecté là où il vient d'agir.
  Object.assign(cadre.fields, fields);
  return json({ ok: true, session: await creerSessionCadre(env, cadre) });
}

/** Le cadre modifie son propre numéro de téléphone (UTILISATEURS.Telephone). */
async function updateProfilCadre(request, env, cadre, info) {
  const body = await request.json().catch(() => ({}));
  if (body.Telephone === undefined) throw httpError(400, "Aucune modification fournie");
  const telephone = cleanText(body.Telephone, 30);
  await gristUpdate(env, T_UTILISATEURS, cadre.rowId, { Telephone: telephone });
  if (info) info.detail = `téléphone : ${telephone || "(vidé)"}`;
  return json({ ok: true, telephone });
}

/** L'étudiant modifie son propre téléphone et/ou e-mail (LISTE_DES_ETUDIANTS). */
async function updateProfilEtudiant(request, env, student, info) {
  const body = await request.json().catch(() => ({}));
  if (body.Numero_de_telephone === undefined && body.Adresse_mail === undefined) {
    throw httpError(400, "Aucune modification fournie");
  }
  const fields = {};
  const details = [];
  if (body.Numero_de_telephone !== undefined) {
    fields.Numero_de_telephone = cleanText(body.Numero_de_telephone, 20);
    details.push(`téléphone : ${fields.Numero_de_telephone || "(vidé)"}`);
  }
  if (body.Adresse_mail !== undefined) {
    const email = cleanText(body.Adresse_mail, 120);
    const actuel = (student.fields.Adresse_mail || "").trim();
    // L'e-mail du dossier EST le 2ᵉ facteur : on ne peut le poser ou le changer
    // qu'après l'avoir prouvé. Sans cette règle, quiconque devine le code d'un
    // dossier dépourvu d'e-mail y inscrit le sien et en verrouille l'accès au
    // détriment de l'étudiant. Le téléphone, lui, reste librement modifiable.
    if (email !== actuel) {
      if (!student.deuxiemeFacteur) {
        throw httpError(403, "L'adresse e-mail de votre dossier ne peut pas être ajoutée ni "
          + "modifiée depuis cet écran : demandez-le à votre cadre de santé.");
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, "Adresse mail invalide");
      fields.Adresse_mail = email;
      details.push(`e-mail : ${email || "(vidé)"}`);
    }
  }
  if (!Object.keys(fields).length) return json({ ok: true, sansChangement: true });
  await gristUpdate(env, T_ETUDIANTS, student.rowId, fields);
  if (info) info.detail = details.join(" · ");
  return json({ ok: true, telephone: fields.Numero_de_telephone, email: fields.Adresse_mail });
}

/** Heures comptabilisées un jour donné (réplique la formule Grist Total_h_semaine). */
function jourInfo(codeRec, dateIso, periodeId, sortiesByJour, feriesSet) {
  const ferie = dateIso ? feriesSet.has(dateIso) : false;
  let h = 0;
  if (codeRec && codeRec.fields.Compte_stage) {
    h = (codeRec.fields.Duree_heures || 0) + (codeRec.fields.Ajustement_h || 0);
  }
  if (dateIso && periodeId) h += sortiesByJour.get(periodeId + "|" + dateIso) || 0;
  // Conformité (arrêté du 31/07/2009) : un jour férié est accordé à l'étudiant.
  // Il n'est PAS compté double ; il est déduit du volume à réaliser (A_FAIRE).
  // Un férié travaillé produit donc un surplus = droit à un jour de récupération.
  return { heures: Math.round(h * 100) / 100, ferie };
}

/* ------------------------------------------------------------------ */
/* Alertes de conformité au droit du travail (repos, durées)           */
/* Contrôle indicatif à partir des codes horaires posés sur le         */
/* planning ; ne remplace pas une vérification humaine.                */
/* ------------------------------------------------------------------ */

const DUREE_MAX_HEBDO = 48; // heures — Code du travail, art. L3121-20
const REPOS_MIN_QUOTIDIEN = 11; // heures entre deux postes — art. L3131-1
const REPOS_MIN_HEBDO = 35; // heures consécutives (24h + 11h) — art. L3132-2

function timeToMinutes(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function addDaysIso(iso, n) {
  return epochToIso(Date.parse(iso + "T00:00:00Z") / 1000 + n * 86400);
}

function mondayOfIso(iso) {
  const day = new Date(iso + "T00:00:00Z").getUTCDay(); // 0 = dimanche .. 6 = samedi
  return addDaysIso(iso, day === 0 ? -6 : 1 - day);
}

function frDateShort(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function formatH(hours) {
  if (hours == null) return "0h";
  const neg = hours < 0;
  const totalMin = Math.round(Math.abs(hours) * 60);
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  return (neg ? "-" : "") + hh + "h" + (mm ? String(mm).padStart(2, "0") : "");
}

/** Jours (ISO, triés) d'une période avec le code horaire posé ce jour-là, limités
 *  aux dates réelles du stage (duIso/auIso) : PLANNING_HEBDO pré-génère des
 *  semaines bien au-delà de la fin du stage (MAX_SEMAINES_GENEREES), il ne
 *  faut pas générer d'alerte sur des jours où l'étudiant n'est pas présent. */
function joursDetailPeriode(periodeId, semaines, codesById, duIso, auIso) {
  const jours = [];
  for (const s of semaines) {
    if (s.fields.Periode !== periodeId) continue;
    const debut = s.fields.Semaine_debut;
    if (!debut) continue;
    DAY_COLUMNS.forEach((d, i) => {
      const iso = epochToIso(debut + i * 86400);
      if (duIso && iso < duIso) return;
      if (auIso && iso > auIso) return;
      const codeRec = codesById.get(s.fields[d]);
      jours.push({ iso, code: codeRec ? codeRec.fields : null });
    });
  }
  return jours.sort((a, b) => a.iso.localeCompare(b.iso));
}

/** Calcule les alertes de conformité d'une période : repos entre deux postes,
 *  durée hebdomadaire max, présence d'un repos hebdomadaire. */
function computeAlertesPeriode(periodeId, semaines, codesById, duIso, auIso) {
  const alertes = [];
  const jours = joursDetailPeriode(periodeId, semaines, codesById, duIso, auIso);

  // 1) Repos minimal entre deux postes travaillés consécutifs (jours calendaires successifs).
  let prev = null;
  for (const j of jours) {
    const travaille = j.code && j.code.Heure_debut && j.code.Heure_fin;
    if (travaille) {
      if (prev && addDaysIso(prev.iso, 1) === j.iso) {
        const finPrev = timeToMinutes(prev.code.Heure_fin);
        const debutPrev = timeToMinutes(prev.code.Heure_debut);
        const debutCur = timeToMinutes(j.code.Heure_debut);
        // Un code de nuit (ex. 19:00–07:00) se termine le lendemain matin :
        // on décale sa fin d'une journée avant de calculer le repos.
        const finPrevAbs = (finPrev <= debutPrev ? 24 * 60 : 0) + finPrev;
        const reposH = (24 * 60 + debutCur - finPrevAbs) / 60;
        if (reposH < REPOS_MIN_QUOTIDIEN) {
          alertes.push(`Repos insuffisant entre le ${frDateShort(prev.iso)} (fin ${prev.code.Heure_fin}) `
            + `et le ${frDateShort(j.iso)} (début ${j.code.Heure_debut}) : ${formatH(reposH)} au lieu de ${REPOS_MIN_QUOTIDIEN}h minimum.`);
        }
      }
      prev = j;
    }
  }

  // 2) Durée hebdomadaire et repos hebdomadaire (semaine calendaire lundi → dimanche).
  const heuresParSemaine = new Map();
  const joursTravaillesParSemaine = new Map();
  for (const j of jours) {
    if (!j.code) continue;
    const lundi = mondayOfIso(j.iso);
    if (j.code.Compte_stage) {
      const h = (j.code.Duree_heures || 0) + (j.code.Ajustement_h || 0);
      heuresParSemaine.set(lundi, (heuresParSemaine.get(lundi) || 0) + h);
    }
    if (j.code.Heure_debut && j.code.Heure_fin) {
      joursTravaillesParSemaine.set(lundi, (joursTravaillesParSemaine.get(lundi) || 0) + 1);
    }
  }
  for (const [lundi, heures] of heuresParSemaine) {
    if (heures > DUREE_MAX_HEBDO) {
      alertes.push(`Semaine du ${frDateShort(lundi)} : ${formatH(heures)} travaillées, `
        + `au-delà du maximum légal de ${DUREE_MAX_HEBDO}h.`);
    }
  }
  for (const [lundi, nbJours] of joursTravaillesParSemaine) {
    if (nbJours >= 7) {
      alertes.push(`Semaine du ${frDateShort(lundi)} : aucun jour de repos posé sur les 7 jours `
        + `(repos hebdomadaire de ${REPOS_MIN_HEBDO}h non garanti).`);
    }
  }

  return alertes;
}

/**
 * Nombre de jours fériés compris dans [du, au] (epoch) qui tombent un jour
 * ouvré (lundi-vendredi).
 *
 * Chaque férié compté retire 7 h du volume à réaliser, au motif qu'il fait
 * perdre un jour de stage. Un férié tombant un samedi ou un dimanche n'en fait
 * perdre aucun : le compter allégeait indûment les heures dues par l'étudiant.
 */
function nombreFeries(feriesIso, duEpoch, auEpoch) {
  if (typeof duEpoch !== "number" || typeof auEpoch !== "number") return 0;
  const duIso = epochToIso(duEpoch);
  const auIso = epochToIso(auEpoch);
  return feriesIso.filter((iso) => {
    if (iso < duIso || iso > auIso) return false;
    const jour = new Date(iso + "T00:00:00Z").getUTCDay(); // 0 = dimanche, 6 = samedi
    return jour !== 0 && jour !== 6;
  }).length;
}

/**
 * Vérifie qu'un dossier trouvé par son code anonymat désigne bien la personne
 * qui s'inscrit. Le code ne retient que les initiales et la date de naissance :
 * deux étudiants peuvent le partager. Sans ce contrôle, le stage du second
 * venait s'ajouter au dossier du premier, silencieusement.
 */
function memeIdentite(dossier, nom, prenom, ddnEpoch) {
  const norm = (s) => String(s || "").trim().toLowerCase();
  const f = dossier.fields || {};
  if (norm(f.NOM) === norm(nom) && norm(f.PRENOM) === norm(prenom) && f.DDN === ddnEpoch) return;
  throw httpError(409, "Un autre dossier porte déjà le même code d'accès (mêmes initiales et "
    + "même date de naissance). Contactez le cadre du service, qui créera votre dossier.");
}

/** Coordonnées du cadre responsable d'un service (nom, email, téléphone). */
function cadreInfo(service, usersById) {
  const ref = service && service.fields.Cadre_ref;
  const u = ref ? usersById.get(ref) : null;
  if (!u) return null;
  const nom = [u.fields.Civilite, u.fields.Nom, u.fields.Prenom]
    .map((x) => (x || "").trim()).filter(Boolean).join(" ");
  return {
    nom,
    email: u.fields.Email || "",
    telephone: u.fields.Telephone || "",
  };
}

/* ------------------------------------------------------------------ */
/* Sorties de stage (déclarations d'heures)                            */
/* ------------------------------------------------------------------ */

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

async function createSortie(request, env, student, info) {
  const body = await request.json().catch(() => ({}));

  const motif = String(body.Motif || "").trim().slice(0, 100);
  const date = String(body.Date || "");
  const debut = String(body.Heure_debut || "").trim();
  const fin = String(body.Heure_fin || "").trim();

  // Même contrainte que la déclaration saisie par le cadre : le motif porte le
  // TYPE (la formule Grist Ajustement_h y reconnaît « Retard »), la précision
  // libre de l'étudiant va dans Motif_ou_Commentaire.
  if (!MOTIFS.includes(motif)) throw httpError(400, "Motif invalide");
  const dateEpoch = exigerDate(date, "Date");
  if (!TIME_RE.test(debut) || !TIME_RE.test(fin)) {
    throw httpError(400, "Heures invalides (format attendu : HH:MM)");
  }

  // « Retard » est déduit par la formule Grist ; les autres motifs comptent
  // comme heures de stage sauf refus explicite.
  const compteStage = motif.toUpperCase() === "RETARD" ? false : body.Compte_stage !== false;

  const periode = await choisirPeriode(env, student, dateEpoch);
  const periodeId = periode ? periode.id : null;

  // Un stage terminé ne se déclare plus : l'étudiant passe par le cadre, qui
  // saisit lui-même la déclaration (le front masque déjà le bouton).
  if (periode && periodeTerminee(periode.fields)) {
    throw httpError(403, "Ce stage est terminé : vous ne pouvez plus y ajouter de déclaration. "
      + "Contactez le cadre de votre service.");
  }

  const fields = {
    Anonymat: student.rowId,
    Code_anonymat: student.code,
    Motif: motif,
    Motif_ou_Commentaire: cleanText(body.Commentaire, 200),
    Date: dateEpoch,
    Heure_debut: debut,
    Heure_fin: fin,
    Compte_stage: compteStage,
  };
  // Rattache explicitement la déclaration à la période de stage, sinon la
  // formule Grist ne peut pas la rapprocher (date hors de l'intervalle, etc.).
  if (periodeId) fields.Rapprochement_manuel = periodeId;

  const data = await grist(env, "POST", `/tables/${T_SORTIES}/records`, { records: [{ fields }] });
  if (info) {
    if (periode) info.serviceId = periode.fields.Service;
    info.detail = `${motif} du ${jDate(date)}, ${debut}–${fin}`
      + (compteStage ? "" : " (ne compte pas dans le stage)");
  }
  return json({ id: data.records[0].id }, 201);
}

/** Période à laquelle rattacher une déclaration datée de dateEpoch (l'enregistrement, ou null). */
async function choisirPeriode(env, student, dateEpoch) {
  const periodes = await gristFilter(env, T_PERIODES, { Code_anonymat: [student.code] });
  if (!periodes.length) return null;
  const DAY = 86400;
  // 1. période dont l'intervalle Du..Au contient la date
  const contient = periodes.find((p) => {
    const du = p.fields.Du, au = p.fields.Au;
    return typeof du === "number" && typeof au === "number" &&
      dateEpoch >= du && dateEpoch <= au + DAY - 1;
  });
  if (contient) return contient;
  // 2. période en cours
  const enCours = periodes.find((p) => p.fields.En_cours);
  if (enCours) return enCours;
  // 3. la plus récente
  return periodes.slice().sort((a, b) => (b.fields.Du || 0) - (a.fields.Du || 0))[0];
}

async function deleteSortie(env, student, rowId, info) {
  const rows = await gristFilter(env, T_SORTIES, { id: [rowId] });
  if (!rows.length) throw httpError(404, "Déclaration introuvable");
  if (rows[0].fields.Anonymat !== student.rowId) {
    throw httpError(403, "Cette déclaration ne vous appartient pas");
  }
  if (rows[0].fields.Valide) {
    throw httpError(403, "Cette déclaration a été validée : contactez votre encadrant pour la modifier");
  }
  await grist(env, "POST", `/tables/${T_SORTIES}/data/delete`, [rowId]);
  if (info) {
    const f = rows[0].fields;
    info.detail = `${f.Motif || "déclaration"} du ${jDateEpoch(f.Date)}`
      + `, ${f.Heure_debut || "?"}–${f.Heure_fin || "?"}`;
  }
  return json({ ok: true });
}

/**
 * Ajoute une nouvelle période de stage à l'étudiant déjà connecté (changement
 * de service, nouveau stage, passage de niveau).
 */
async function creerPeriodeEtudiant(request, env, student, info) {
  const body = await request.json().catch(() => ({}));
  const serviceId = Number(body.Service);
  const du = String(body.Du || "");
  const au = String(body.Au || "");
  const niveau = NIVEAUX.includes(body.Niveau) ? body.Niveau : "";

  const duEpoch = exigerDate(du, "Date de début de stage");
  const auEpoch = exigerDate(au, "Date de fin de stage");
  if (duEpoch > auEpoch) throw httpError(400, "La fin du stage doit être après le début");
  verifierDureeStage(duEpoch, auEpoch);

  const services = await gristAll(env, T_SERVICES);
  const service = services.find((s) => s.id === serviceId && s.fields.Recoit_des_etudiant);
  if (!service) throw httpError(400, "Service invalide");

  const periodes = await gristFilter(env, T_PERIODES, { Code_anonymat: [student.code] });
  if (periodes.some((p) => p.fields.Du === duEpoch)) {
    throw httpError(409, "Une période de stage commençant à cette date existe déjà.");
  }

  const { periodeId, semainesGenerees } = await creerPeriodeAvecSemaines(env, {
    studentRowId: student.rowId, code: student.code, serviceId, du, au, niveau, referent: "",
  });
  if (info) {
    info.serviceId = serviceId;
    info.detail = `stage du ${jDate(du)} au ${jDate(au)}${niveau ? ", " + niveau : ""}`
      + `, ${semainesGenerees} semaine(s) générée(s)`;
  }
  return json({ id: periodeId, semainesGenerees }, 201);
}

/* ------------------------------------------------------------------ */
/* Inscription (« entrée en stage »)                                   */
/* ------------------------------------------------------------------ */

async function inscription(request, env, ctx) {
  const body = await request.json().catch(() => ({}));

  // Champ-piège anti-robots : rempli uniquement par les robots
  if (body.website) throw httpError(400, "Requête refusée");

  const nom = cleanText(body.NOM, 80);
  const prenom = cleanText(body.PRENOM, 80);
  const ddn = String(body.DDN || "");
  const civilite = CIVILITES.includes(body.Civilite) ? body.Civilite : "";
  const formation = FORMATIONS.includes(body.FORMATION) ? body.FORMATION : "";
  const centre = cleanText(body.Centre_de_formation, 120);
  const email = cleanText(body.Adresse_mail, 120);
  const telephone = cleanText(body.Numero_de_telephone, 20);

  const p = body.periode || {};
  const serviceId = Number(p.Service);
  const du = String(p.Du || "");
  const au = String(p.Au || "");
  const niveau = NIVEAUX.includes(p.Niveau) ? p.Niveau : "";
  const referent = cleanText(p.Referent_pedagogique, 80);

  if (!nom || !prenom) throw httpError(400, "Nom et prénom obligatoires");
  const ddnEpoch = exigerDate(ddn, "Date de naissance");
  if (!formation) throw httpError(400, "Formation obligatoire");
  const duEpoch = exigerDate(du, "Date de début de stage");
  const auEpoch = exigerDate(au, "Date de fin de stage");
  if (duEpoch > auEpoch) throw httpError(400, "La fin du stage doit être après le début");
  verifierDureeStage(duEpoch, auEpoch);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, "Adresse mail invalide");

  const services = await gristAll(env, T_SERVICES);
  const service = services.find((s) => s.id === serviceId && s.fields.Recoit_des_etudiant);
  if (!service) throw httpError(400, "Service invalide");

  // Code anonymat calculé comme la formule Grist :
  // PRENOM[0].upper() + DDN JJMMAA + NOM[0].upper()
  const [y, mo, d] = ddn.split("-");
  const code = (prenom[0] + d + mo + y.slice(2) + nom[0]).toUpperCase();

  // Étudiant déjà connu ? On ne crée que la nouvelle période.
  const existing = await gristFilter(env, T_ETUDIANTS, { Anonymat: [code] });
  let studentRowId;
  let dejaInscrit = false;

  if (existing.length === 1) {
    // Le code ne distingue que les initiales et la date de naissance : deux
    // personnes différentes peuvent le partager. Sans cette vérification, le
    // stage du second serait rattaché au dossier du premier.
    memeIdentite(existing[0], nom, prenom, ddnEpoch);
    studentRowId = existing[0].id;
    dejaInscrit = true;
    const periodes = await gristFilter(env, T_PERIODES, { Code_anonymat: [code] });
    if (periodes.some((per) => per.fields.Du === duEpoch)) {
      throw httpError(409, "Une période de stage commençant à cette date existe déjà. Connectez-vous avec votre code.");
    }
  } else if (existing.length > 1) {
    throw httpError(409, "Plusieurs dossiers correspondent à ce code : contactez votre encadrant.");
  } else {
    const studentFields = {
      NOM: nom,
      PRENOM: prenom,
      DDN: ddnEpoch,
      FORMATION: formation,
      Civilite: civilite,
      Centre_de_formation: centre,
      Adresse_mail: email,
      Numero_de_telephone: telephone,
    };
    const created = await grist(env, "POST", `/tables/${T_ETUDIANTS}/records`, {
      records: [{ fields: studentFields }],
    });
    studentRowId = created.records[0].id;
  }

  const { semainesGenerees } = await creerPeriodeAvecSemaines(env, {
    studentRowId, code, serviceId, du, au, niveau, referent,
  });

  // L'auto-inscription crée un dossier et un stage sans qu'aucun cadre
  // n'intervienne : elle a toute sa place dans le journal.
  logActivite(env, ctx, {
    role: "Étudiant",
    qui: code,
    nom: `${prenom} ${nom}`.trim(),
    action: "Inscription (entrée en stage)",
    serviceId,
    detail: `${dejaInscrit ? "dossier existant" : "nouveau dossier"}`
      + ` — stage du ${jDate(du)} au ${jDate(au)}${niveau ? ", " + niveau : ""}`
      + `, ${semainesGenerees} semaine(s) générée(s)`
      + (referent ? `, référent ${referent}` : ""),
  });

  return json({ code, dejaInscrit, semainesGenerees }, 201);
}

/**
 * Crée une période de stage + les semaines de planning vides associées.
 * Facteur commun entre l'inscription publique et l'inscription par le cadre.
 * A_FAIRE = 35 h/semaine moins les jours fériés (accordés à l'étudiant).
 */
async function creerPeriodeAvecSemaines(env, { studentRowId, code, serviceId, du, au, niveau, referent }) {
  const duEpoch = exigerDate(du, "Date de début de stage");
  const auEpoch = exigerDate(au, "Date de fin de stage");

  const feries = await gristAll(env, T_FERIES);
  const feriesIso = feries.map((f) => epochToIso(f.fields.Date)).filter(Boolean);
  const aFaire = Math.max(0,
    HEURES_PAR_SEMAINE * nombreSemaines(duEpoch, auEpoch)
    - HEURES_PAR_SEMAINE / 5 * nombreFeries(feriesIso, duEpoch, auEpoch));

  const createdPeriode = await grist(env, "POST", `/tables/${T_PERIODES}/records`, {
    records: [{
      fields: {
        Anonymat: studentRowId,
        Code_anonymat: code,
        Du: duEpoch,
        Au: auEpoch,
        Niveau: niveau,
        Service: serviceId,
        Referent_pedagogique: referent,
        A_FAIRE: aFaire,
      },
    }],
  });
  const periodeId = createdPeriode.records[0].id;

  // Génère une semaine de planning (vide) par semaine de stage,
  // que le service remplira ensuite dans Grist.
  const semainesGenerees = await genererSemaines(env, periodeId, duEpoch, auEpoch);
  return { periodeId, semainesGenerees };
}

/**
 * Inscription par le cadre : soit un tout nouvel étudiant (identité complète,
 * mêmes règles que l'inscription publique), soit l'ajout d'une période à un
 * étudiant existant (body.etudiantId). Restreint aux services du cadre.
 */
async function inscriptionParCadre(request, env, cadre, info) {
  const body = await request.json().catch(() => ({}));
  const p = body.periode || {};
  const serviceId = Number(p.Service);
  if (!cadre.serviceIds.has(serviceId)) throw httpError(403, "Ce service ne vous est pas rattaché");
  const service = cadre.services.find((s) => s.id === serviceId);
  if (!service || !service.fields.Recoit_des_etudiant) throw httpError(400, "Ce service n'accueille pas d'étudiants");

  const du = String(p.Du || "");
  const au = String(p.Au || "");
  const niveau = NIVEAUX.includes(p.Niveau) ? p.Niveau : "";
  const referent = cleanText(p.Referent_pedagogique, 80);
  const duEpoch = exigerDate(du, "Date de début de stage");
  const auEpoch = exigerDate(au, "Date de fin de stage");
  if (duEpoch > auEpoch) throw httpError(400, "La fin du stage doit être après le début");
  verifierDureeStage(duEpoch, auEpoch);

  let studentRowId;
  let code;
  let dossierCree = false; // vrai si la fiche étudiant a été créée à l'occasion

  const etuIdFourni = body.etudiantId !== undefined && body.etudiantId !== null && body.etudiantId !== "";
  if (etuIdFourni) {
    // Étudiant déjà connu : on récupère son code anonymat existant.
    const etuId = Number(body.etudiantId);
    const rows = await gristFilter(env, T_ETUDIANTS, { id: [etuId] });
    if (!rows.length) throw httpError(404, "Étudiant introuvable");
    studentRowId = etuId;
    code = (rows[0].fields.Anonymat || "").toUpperCase();
    if (!code) throw httpError(400, "Cet étudiant n'a pas de code anonymat");
  } else {
    // Nouvel étudiant : mêmes validations que l'inscription publique.
    const nom = cleanText(body.NOM, 80);
    const prenom = cleanText(body.PRENOM, 80);
    const ddn = String(body.DDN || "");
    const civilite = CIVILITES.includes(body.Civilite) ? body.Civilite : "";
    const formation = FORMATIONS.includes(body.FORMATION) ? body.FORMATION : "";
    const centre = cleanText(body.Centre_de_formation, 120);
    const email = cleanText(body.Adresse_mail, 120);
    const telephone = cleanText(body.Numero_de_telephone, 20);

    if (!nom || !prenom) throw httpError(400, "Nom et prénom obligatoires");
    const ddnEpoch = exigerDate(ddn, "Date de naissance");
    if (!formation) throw httpError(400, "Formation obligatoire");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, "Adresse mail invalide");

    const [y, mo, d] = ddn.split("-");
    code = (prenom[0] + d + mo + y.slice(2) + nom[0]).toUpperCase();

    const existing = await gristFilter(env, T_ETUDIANTS, { Anonymat: [code] });
    if (existing.length === 1) {
      // Homonyme né le même jour : c'est un autre étudiant, pas le même dossier.
      memeIdentite(existing[0], nom, prenom, ddnEpoch);
      studentRowId = existing[0].id;
    } else if (existing.length > 1) {
      throw httpError(409, "Plusieurs dossiers correspondent à ce code : contactez l'administrateur");
    } else {
      const created = await grist(env, "POST", `/tables/${T_ETUDIANTS}/records`, {
        records: [{ fields: {
          NOM: nom,
          PRENOM: prenom,
          DDN: ddnEpoch,
          FORMATION: formation,
          Civilite: civilite,
          Centre_de_formation: centre,
          Adresse_mail: email,
          Numero_de_telephone: telephone,
        } }],
      });
      studentRowId = created.records[0].id;
      dossierCree = true;
    }
  }

  // Refus d'un doublon : même date de début sur le même service.
  const periodesEtu = await gristFilter(env, T_PERIODES, { Code_anonymat: [code] });
  if (periodesEtu.some((per) => per.fields.Du === duEpoch && per.fields.Service === serviceId)) {
    throw httpError(409, "Une période commençant à cette date existe déjà pour cet étudiant sur ce service");
  }

  const { periodeId, semainesGenerees } = await creerPeriodeAvecSemaines(env, {
    studentRowId, code, serviceId, du, au, niveau, referent,
  });
  if (info) {
    info.etudiantId = studentRowId;
    info.serviceId = serviceId;
    info.detail = `${dossierCree ? "nouveau dossier" : "dossier existant"}`
      + ` — stage du ${jDate(du)} au ${jDate(au)}${niveau ? ", " + niveau : ""}`
      + `, ${semainesGenerees} semaine(s) générée(s)`
      + (referent ? `, référent ${referent}` : "");
  }
  return json({ code, periodeId, semainesGenerees }, 201);
}

/**
 * Recherche d'un étudiant (pour éviter les doublons avant de créer une période).
 * Cherche dans TOUTE la base élèves par nom / prénom / code anonymat ; renvoie
 * des champs volontairement minimaux (PAS de DDN ni de téléphone). Indique si
 * l'étudiant a déjà un stage dans un des services du cadre.
 */
async function rechercherEtudiants(request, env, cadre, info) {
  const q = (new URL(request.url).searchParams.get("q") || "").trim().toLowerCase();
  if (info) info.detail = `« ${q} »`;
  if (q.length < 2) return json({ resultats: [] });

  const [students, periodesAll] = await Promise.all([
    gristAll(env, T_ETUDIANTS),
    gristAll(env, T_PERIODES),
  ]);
  const dansMes = new Set(periodesAll
    .filter((p) => cadre.serviceIds.has(p.fields.Service))
    .map((p) => p.fields.Etudiant).filter(Boolean));

  const norm = (s) => String(s || "").toLowerCase();
  const resultats = students
    .filter((e) => {
      const nom = norm(e.fields.NOM);
      const prenom = norm(e.fields.PRENOM);
      const code = norm(e.fields.Anonymat);
      return nom.includes(q) || prenom.includes(q) || code.includes(q)
        || `${prenom} ${nom}`.includes(q) || `${nom} ${prenom}`.includes(q);
    })
    .slice(0, 25)
    .map((e) => ({
      id: e.id,
      nom: e.fields.NOM || "",
      prenom: e.fields.PRENOM || "",
      anonymat: e.fields.Anonymat || "",
      formation: e.fields.FORMATION || "",
      centre: e.fields.Centre_de_formation || "",
      dansMesServices: dansMes.has(e.id),
    }));
  if (info) info.detail = `« ${q} » — ${resultats.length} résultat(s)`;
  return json({ resultats });
}

/** Le cadre configure le modèle de mail de bienvenue de son service
 *  (colonnes SERVICES.Mail_bienvenue_objet / Mail_bienvenue_corps). */
async function updateMailBienvenue(request, env, cadre, serviceId, info) {
  if (!cadre.serviceIds.has(serviceId)) throw httpError(403, "Ce service ne vous est pas rattaché");
  const body = await request.json().catch(() => ({}));
  const objet = cleanText(body.objet, 150);
  const corps = cleanText(body.corps, 4000);
  await gristUpdate(env, T_SERVICES, serviceId, {
    Mail_bienvenue_objet: objet,
    Mail_bienvenue_corps: corps,
  });
  if (info) {
    info.serviceId = serviceId;
    info.detail = `objet : « ${objet || "(vide)"} », corps : ${corps.length} caractère(s)`;
  }
  return json({ ok: true, objet, corps });
}

function cleanText(value, max) {
  return String(value || "").trim().slice(0, max);
}

/**
 * Liste des lundis (epoch) couvrant la période [du, au]. Le nombre de semaines
 * n'est PAS plafonné ici : le plafond ne concerne que la création (voir
 * verifierDureeStage), pour qu'une période déjà enregistrée — plus longue,
 * saisie directement dans Grist — voie quand même ses heures calculées juste.
 */
function lundisDeLaPeriode(du, au) {
  const DAY = 86400;
  if (typeof du !== "number" || typeof au !== "number") return [];
  // Lundi de la semaine du début de stage (getUTCDay : lundi = 1)
  const shift = (new Date(du * 1000).getUTCDay() + 6) % 7;
  let monday = du - shift * DAY;
  const lundis = [];
  // Garde-fou : une date aberrante ne doit pas faire tourner la boucle sans fin.
  while (monday <= au && lundis.length < 520) {
    lundis.push(monday);
    monday += 7 * DAY;
  }
  return lundis;
}

/** Nombre de semaines de stage couvertes par la période. */
function nombreSemaines(du, au) {
  return lundisDeLaPeriode(du, au).length;
}

/**
 * Refuse un stage plus long que ce que l'application sait générer. Avant, la
 * génération s'arrêtait en silence à 30 semaines : le planning était tronqué et
 * les heures à réaliser sous-évaluées, sans que personne en soit averti.
 */
function verifierDureeStage(duEpoch, auEpoch) {
  const semaines = nombreSemaines(duEpoch, auEpoch);
  if (semaines > MAX_SEMAINES_GENEREES) {
    throw httpError(400, `Ce stage couvre ${semaines} semaines, au-delà du maximum de `
      + `${MAX_SEMAINES_GENEREES} géré par l'application. Vérifiez les dates, ou `
      + `enregistrez le stage en plusieurs périodes.`);
  }
}

async function genererSemaines(env, periodeId, du, au) {
  const records = lundisDeLaPeriode(du, au)
    .map((monday) => ({ fields: { Periode: periodeId, Semaine_debut: monday } }));
  if (records.length) {
    await grist(env, "POST", `/tables/${T_HEBDO}/records`, { records });
  }
  return records.length;
}

/* ------------------------------------------------------------------ */
/* Client Grist                                                        */
/* ------------------------------------------------------------------ */

async function grist(env, method, path, body) {
  const base = (env.GRIST_BASE_URL || "https://grist.numerique.gouv.fr/api").replace(/\/$/, "");
  const res = await fetch(`${base}/docs/${env.GRIST_DOC_ID}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.GRIST_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`Grist ${method} ${path} -> ${res.status}: ${await res.text()}`);
    throw httpError(502, "Erreur de communication avec Grist");
  }
  return res.json().catch(() => ({}));
}

async function gristFilter(env, table, filter) {
  const q = encodeURIComponent(JSON.stringify(filter));
  const data = await grist(env, "GET", `/tables/${table}/records?filter=${q}`);
  return data.records || [];
}

async function gristAll(env, table) {
  const data = await grist(env, "GET", `/tables/${table}/records`);
  return data.records || [];
}

async function gristUpdate(env, table, id, fields) {
  await grist(env, "PATCH", `/tables/${table}/records`, { records: [{ id, fields }] });
}

/* ------------------------------------------------------------------ */
/* Journal d'activité (connexions + actions)                           */
/* ------------------------------------------------------------------ */

/** Nom complet d'un étudiant pour le journal. */
function nomCompletEtudiant(student) {
  const f = (student && student.fields) || {};
  return [f.PRENOM, f.NOM].map((x) => (x || "").toString().trim()).filter(Boolean).join(" ");
}

/** Nom complet d'un étudiant à partir de son id de ligne (LISTE_DES_ETUDIANTS).
 * Best-effort : renvoie "" si introuvable. Utilisé pour enrichir le journal. */
async function nomEtudiantParId(env, id) {
  if (!id) return "";
  const rows = await gristFilter(env, T_ETUDIANTS, { id: [id] }).catch(() => []);
  if (!rows.length) return "";
  return nomCompletEtudiant(rows[0]);
}

// Colonnes ajoutées automatiquement au journal, en plus des colonnes
// historiques (Horodatage, Role, Qui, Nom, Action, Detail). Elles rendent le
// journal filtrable dans Grist : « tout ce qui s'est passé dans tel service »,
// « tout ce qui concerne tel étudiant ».
const JOURNAL_COLONNES = [
  { id: "Site", label: "Site", type: "Text" },
  { id: "Service", label: "Service", type: "Text" },
  { id: "Etudiant", label: "Étudiant concerné", type: "Text" },
];
let journalColonnesOk = false; // colonnes vérifiées une fois par isolat

// Cache mémoire (par isolat) des noms de service et de site. Utilisé seulement
// par le journal, dans le waitUntil : aucune latence pour l'utilisateur, et un
// nom vieux de quelques minutes est sans conséquence sur une ligne de journal.
const SERVICES_CACHE_MS = 5 * 60 * 1000;
let servicesCache = { at: 0, byId: new Map(), byNom: new Map() };

/** { service, site } d'un service désigné par son id ou par son nom.
 *  Best-effort : renvoie des chaînes vides si Grist est indisponible. */
async function resoudreService(env, serviceId, serviceNom) {
  const vide = { service: serviceNom || "", site: "" };
  if (!serviceId && !serviceNom) return { service: "", site: "" };
  try {
    if (Date.now() - servicesCache.at > SERVICES_CACHE_MS) {
      const [services, sites] = await Promise.all([gristAll(env, T_SERVICES), gristAll(env, T_SITES)]);
      const sitesById = new Map(sites.map((s) => [s.id, s]));
      const byId = new Map();
      const byNom = new Map();
      for (const s of services) {
        const info = { service: s.fields.Nom || "", site: siteName(s, sitesById) };
        byId.set(s.id, info);
        if (info.service) byNom.set(info.service, info);
      }
      servicesCache = { at: Date.now(), byId, byNom };
    }
  } catch {
    return vide;
  }
  return (serviceId ? servicesCache.byId.get(serviceId) : servicesCache.byNom.get(serviceNom)) || vide;
}

/**
 * Écrit une ligne dans JOURNAL_ACTIVITE. Best-effort : une erreur d'écriture
 * du journal ne doit JAMAIS faire échouer la requête de l'utilisateur.
 * Via ctx.waitUntil, l'écriture se fait après l'envoi de la réponse (aucune latence).
 *
 * Champs de `entry` : role, qui, nom, action, detail, plus le contexte
 * (résolu ici, donc sans latence) :
 *   - `etudiantId` (ou `etudiant`) -> colonne Étudiant concerné ;
 *   - `serviceId` (ou `service`)   -> colonnes Service et Site.
 */
function logActivite(env, ctx, entry) {
  const p = (async () => {
    if (!journalColonnesOk) {
      journalColonnesOk = await ensureColumns(env, T_JOURNAL, JOURNAL_COLONNES)
        .then(() => true).catch(() => false);
    }
    let etudiant = entry.etudiant || "";
    if (!etudiant && entry.etudiantId != null) {
      etudiant = await nomEtudiantParId(env, entry.etudiantId).catch(() => "");
    }
    // Une ligne d'étudiant concerne l'étudiant connecté : la colonne est
    // remplie aussi pour lui, afin de filtrer un dossier d'un seul coup.
    if (!etudiant && entry.role === "Étudiant") etudiant = entry.nom || "";
    const { service, site } = await resoudreService(env, entry.serviceId, entry.service);
    return grist(env, "POST", `/tables/${T_JOURNAL}/records`, {
      records: [{
        fields: {
          Horodatage: Math.floor(Date.now() / 1000),
          Role: entry.role || "",
          Qui: entry.qui || "",
          Nom: entry.nom || "",
          Action: entry.action || "",
          Detail: cleanText(entry.detail, 300),
          Site: site,
          Service: service,
          Etudiant: etudiant,
        },
      }],
    });
  })().catch((e) => console.error("JOURNAL_ACTIVITE:", (e && e.message) || e));
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p);
}

/* --- Connexions refusées -------------------------------------------
 * Ne journaliser que les connexions réussies laisserait invisible ce qui
 * intéresse le plus en cas de doute : les essais qui n'ont PAS abouti (code
 * d'accès faux, PIN erroné, compte désactivé ou bloqué).
 *
 * Ces lignes-là sont les seules qu'un visiteur non authentifié puisse
 * provoquer, d'où deux précautions :
 *   - le secret essayé (code d'accès, PIN) n'est JAMAIS écrit, seulement
 *     l'identifiant visé (code anonymat ou e-mail) ;
 *   - un anti-flood borne le nombre de lignes qu'un même identifiant ou une
 *     même IP peut produire : sans lui, un essai en série chasserait du
 *     journal les 30 jours d'activité réelle.
 */
const REFUS_FENETRE_MS = 10 * 60 * 1000;
const REFUS_MAX_PAR_IP = 5; // lignes par IP et par fenêtre
const refusJournalises = new Map();

/** Vrai si la clé n'a pas encore atteint `max` lignes dans la fenêtre en cours. */
function refusAJournaliser(cle, max) {
  const maintenant = Date.now();
  if (refusJournalises.size > 5000) {
    for (const [k, v] of refusJournalises) if (v.expire <= maintenant) refusJournalises.delete(k);
  }
  const vu = refusJournalises.get(cle);
  if (!vu || vu.expire <= maintenant) {
    refusJournalises.set(cle, { expire: maintenant + REFUS_FENETRE_MS, n: 1 });
    return true;
  }
  vu.n++;
  return vu.n <= max;
}

/**
 * Journalise une tentative de connexion refusée. `motif` dit ce qui a bloqué
 * (il fait partie de la clé anti-flood : chaque motif a droit à sa ligne).
 */
function logRefusConnexion(env, ctx, { role, qui, nom, ip, motif }) {
  const identifiant = cleanText(qui, 60);
  // Une ligne par identifiant visé, par motif et par fenêtre : l'information
  // utile est « on a essayé d'entrer sur ce compte », pas le nombre exact
  // d'essais — la limitation de débit s'en charge déjà.
  if (!refusAJournaliser(`refus:${role}:${identifiant.toLowerCase()}:${motif}`, 1)) return;
  if (!refusAJournaliser(`refus:ip:${ip}`, REFUS_MAX_PAR_IP)) return;
  logActivite(env, ctx, {
    role,
    qui: identifiant || "(vide)",
    nom: nom || "",
    action: "Connexion refusée",
    detail: motif,
  });
}

/**
 * Exécute une action, puis journalise si elle a réussi (sinon l'erreur remonte, pas de log).
 * `fn` reçoit un objet `info` qu'elle peut enrichir pour préciser le journal :
 *   - `info.detail` : texte libre (dates, motif, valeurs modifiées…)
 *   - `info.etudiantId` : id de l'étudiant concerné (colonne Étudiant concerné)
 *   - `info.serviceId` : id du service concerné (colonnes Service et Site)
 * `detail` sert de valeur par défaut si `fn` n'enrichit rien.
 */
async function withLog(env, ctx, who, action, detail, fn) {
  const info = { detail: detail || "", etudiantId: undefined, serviceId: undefined };
  const res = await fn(info);
  logActivite(env, ctx, {
    ...who, action,
    detail: info.detail,
    etudiantId: info.etudiantId,
    serviceId: info.serviceId,
  });
  return res;
}

/** Date ISO -> JJ/MM/AAAA pour le journal ("?" si la date manque). */
function jDate(iso) {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? frDateShort(iso) : "?";
}

/** Epoch Grist -> JJ/MM/AAAA pour le journal. */
function jDateEpoch(epoch) {
  return jDate(epochToIso(epoch));
}

/** Valeur lisible dans le journal (booléens, vides, dates epoch). */
function jValeur(v, epoch) {
  if (v === true) return "oui";
  if (v === false) return "non";
  if (v === null || v === undefined || v === "") return "(vide)";
  return epoch ? jDateEpoch(v) : String(v);
}

/**
 * Liste « libellé : ancien → nouveau » des champs réellement modifiés, pour
 * que le journal dise ce qui a changé et pas seulement qu'il y a eu un
 * changement. `labels` = { colonneGrist: "libellé" } ou { col: ["libellé", true] }
 * pour une colonne date (epoch).
 */
function changementsTexte(labels, avant, apres) {
  const out = [];
  for (const [col, spec] of Object.entries(labels)) {
    if (apres[col] === undefined) continue;
    const [libelle, epoch] = Array.isArray(spec) ? spec : [spec, false];
    const a = jValeur(avant[col], epoch);
    const b = jValeur(apres[col], epoch);
    if (a === b) continue;
    out.push(`${libelle} : ${a} → ${b}`);
  }
  return out;
}

/** Résumé du stage d'un étudiant (payload /api/data) pour le journal. */
function contexteStageEtudiant(payload) {
  const periodes = (payload && payload.periodes) || [];
  const p = periodes.find((x) => x.En_cours) || periodes[periodes.length - 1];
  if (!p) return { detail: "aucun stage enregistré" };
  const etat = p.En_cours ? "stage en cours" : "dernier stage";
  return {
    service: p.Service || "",
    detail: `${etat} : ${jDate(p.Du)} → ${jDate(p.Au)}${p.Niveau ? ", " + p.Niveau : ""}`,
  };
}

// Durée de conservation du journal (jours). Au-delà, les lignes sont purgées.
const JOURNAL_RETENTION_JOURS = 30;

// Les purges sont déclenchées à chaque connexion, mais elles relisent des
// tables entières (tout PLANNING_HEBDO pour les semaines orphelines) : inutile
// de recommencer à chaque fois. Une passe par heure et par isolat suffit
// largement pour du ménage, et le coût par connexion redevient nul.
const PURGE_INTERVALLE_MS = 3600 * 1000;
const dernieresPurges = new Map();
function purgeTropRecente(nom) {
  const maintenant = Date.now();
  if (maintenant - (dernieresPurges.get(nom) || 0) < PURGE_INTERVALLE_MS) return true;
  dernieresPurges.set(nom, maintenant);
  return false;
}

/**
 * Supprime les lignes du journal de plus de JOURNAL_RETENTION_JOURS.
 * Appelé à chaque connexion (fréquence raisonnable). Best-effort, en waitUntil,
 * par lots de 500 lignes les plus anciennes (les suivantes partiront à la prochaine connexion).
 */
function purgeJournal(env, ctx) {
  if (purgeTropRecente("journal")) return;
  const p = (async () => {
    const cutoff = Math.floor(Date.now() / 1000) - JOURNAL_RETENTION_JOURS * 24 * 3600;
    const data = await grist(env, "GET", `/tables/${T_JOURNAL}/records?sort=Horodatage&limit=500`);
    const old = (data.records || [])
      .filter((r) => (r.fields.Horodatage || 0) < cutoff)
      .map((r) => r.id);
    if (old.length) await grist(env, "POST", `/tables/${T_JOURNAL}/data/delete`, old);
  })().catch((e) => console.error("purgeJournal:", (e && e.message) || e));
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p);
}

// Délai de grâce avant purge d'une semaine de planning orpheline (jours).
const HEBDO_ORPHELIN_RETENTION_JOURS = 30;

/**
 * Purge les semaines PLANNING_HEBDO qui ne sont plus rattachées à aucune
 * période de stage existante (référence vide ou période supprimée) et dont le
 * lundi remonte à plus de HEBDO_ORPHELIN_RETENTION_JOURS : passé ce délai,
 * personne ne viendra les re-rattacher. Appelé à chaque connexion et après
 * chaque suppression de période. Best-effort, en waitUntil, par lots de 500.
 */
function purgePlanningsOrphelins(env, ctx) {
  if (purgeTropRecente("plannings")) return;
  const p = (async () => {
    const cutoff = Math.floor(Date.now() / 1000) - HEBDO_ORPHELIN_RETENTION_JOURS * 24 * 3600;
    const [semaines, periodes] = await Promise.all([
      gristAll(env, T_HEBDO),
      gristAll(env, T_PERIODES),
    ]);
    const periodeIds = new Set(periodes.map((r) => r.id));
    const orphelines = semaines
      .filter((s) => !periodeIds.has(s.fields.Periode)
        && (s.fields.Semaine_debut || 0) < cutoff)
      .slice(0, 500)
      .map((s) => s.id);
    if (orphelines.length) {
      await grist(env, "POST", `/tables/${T_HEBDO}/data/delete`, orphelines);
      console.log(`purgePlanningsOrphelins: ${orphelines.length} semaine(s) purgée(s)`);
    }
  })().catch((e) => console.error("purgePlanningsOrphelins:", (e && e.message) || e));
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p);
}

/* ------------------------------------------------------------------ */
/* Utilitaires                                                         */
/* ------------------------------------------------------------------ */

function epochToIso(value) {
  if (typeof value !== "number") return value || null;
  return new Date(value * 1000).toISOString().slice(0, 10);
}

/**
 * Date « AAAA-MM-JJ » -> epoch (secondes, minuit UTC), ou null si la date
 * n'existe pas.
 *
 * Le seul contrôle par expression régulière ne suffit pas : « 2026-02-31 »
 * passe le filtre mais Date.parse le décale silencieusement au 3 mars, et
 * « 2026-13-01 » donne NaN, écrit ensuite comme date VIDE dans Grist (et les
 * comparaisons du > au, fausses avec NaN, ne rattrapaient rien). On exige donc
 * que la date relue redonne exactement la chaîne de départ.
 */
function isoToEpoch(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""))) return null;
  const epoch = Date.parse(iso + "T00:00:00Z") / 1000;
  if (!Number.isFinite(epoch)) return null;
  return epochToIso(epoch) === iso ? epoch : null;
}

/** Comme isoToEpoch, mais lève une 400 explicite si la date n'existe pas. */
function exigerDate(iso, libelle) {
  const epoch = isoToEpoch(iso);
  if (epoch === null) throw httpError(400, `${libelle} invalide`);
  return epoch;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

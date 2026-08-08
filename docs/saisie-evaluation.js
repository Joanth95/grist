/* Saisie d'une évaluation par un professionnel du service.
   © Joan Thuillier — Tous droits réservés. Voir LICENSE à la racine du dépôt.

   Le professionnel n'a pas de compte : il arrive par un lien qui désigne UN
   étudiant (#jeton=<uuid de la période>), saisit le code du service et
   choisit son nom dans la liste.

   La saisie se fait DEVANT L'ÉTUDIANT (arrêté du 20 février 2026). L'écran
   n'a donc aucune zone masquée, et un récapitulatif se lit à deux avant
   l'envoi. La confirmation de présence est exigée par le serveur. */

const API = (window.CONFIG && window.CONFIG.API_URL) || "";

/* Le jeton vit dans le FRAGMENT, jamais dans la query string : il n'est ni
   envoyé au serveur d'hébergement, ni recopié dans un en-tête Referer. */
const params = new URLSearchParams(
  location.hash.length > 1 ? location.hash.slice(1) : location.search.slice(1));
const JETON = (params.get("jeton") || "").trim();

const ECHELLES = {
  acquisition: [
    { v: "non_acquis", t: "Non acquis" },
    { v: "a_ameliorer", t: "À améliorer" },
    { v: "acquis", t: "Acquis" },
    { v: "non_mobilise", t: "Non mobilisé", cls: "neutre" },
  ],
  oui_non: [
    { v: "oui", t: "Oui" },
    { v: "non", t: "Non", cls: "non" },
    { v: "non_applicable", t: "Non applic.", cls: "neutre" },
  ],
};
const LIBELLE_VALEUR = {};
for (const opts of Object.values(ECHELLES)) for (const o of opts) LIBELLE_VALEUR[o.v] = o.t;

const CLE_PRO = "saisie-eval-pro";
const CLE_BROUILLON = "saisie-eval-brouillon";

const etat = {
  code: "",
  contexte: null,      // réponse de /api/saisie/contexte
  proId: 0,
  proNom: "",
  grille: null,
  reponses: new Map(), // itemId -> { valeur, commentaire }
  ecran: 0,
  uuid: "",
};

const $ = (id) => document.getElementById(id);

async function api(method, chemin, body) {
  const res = await fetch(API + chemin, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

/* ---------------------------------------------------------------- */
/* Navigation                                                        */
/* ---------------------------------------------------------------- */

const TITRES = {
  0: "Code du service", 1: "Qui remplit", 2: "Choix du soin",
  3: "Grille d'évaluation", 4: "À relire ensemble", 5: "Terminé",
};

function aller(n) {
  etat.ecran = n;
  for (let i = 0; i <= 5; i++) $("sa-e" + i).classList.toggle("actif", i === n);
  window.scrollTo(0, 0);
  $("sa-retour").hidden = !(n === 1 || n === 2 || n === 3 || n === 4);
  $("sa-pied").hidden = (n === 5);
  $("sa-fil").textContent = etat.contexte
    ? `${etat.contexte.service.nom} · ${TITRES[n]}` : TITRES[n];
  majPied();
}

$("sa-retour").addEventListener("click", () => {
  if (etat.ecran === 4) return aller(3);
  if (etat.ecran === 3) return aller(2);
  if (etat.ecran === 2) return aller(1);
  if (etat.ecran === 1) return aller(0);
});

/* Le bouton du pied change de rôle selon l'écran : un seul bouton principal
   à l'écran, toujours au même endroit sous le pouce. */
function majPied() {
  const btn = $("sa-principal");
  const sous = $("sa-sous");
  btn.disabled = false;
  sous.textContent = "";

  if (etat.ecran === 0) {
    btn.textContent = "Ouvrir";
    btn.disabled = !$("sa-code").value.trim();
  } else if (etat.ecran === 1 || etat.ecran === 2) {
    $("sa-pied").hidden = true;
    return;
  } else if (etat.ecran === 3) {
    const total = questionsDeLaGrille().length;
    const repondues = questionsDeLaGrille().filter((i) => (etat.reponses.get(i.id) || {}).valeur).length;
    const manquantes = obligatoiresManquantes().length;
    btn.textContent = "Relire avec l'étudiant";
    btn.disabled = manquantes > 0;
    sous.textContent = manquantes > 0
      ? `${manquantes} réponse${manquantes > 1 ? "s" : ""} obligatoire${manquantes > 1 ? "s" : ""} manquante${manquantes > 1 ? "s" : ""}`
      : `${repondues} / ${total} question${total > 1 ? "s" : ""} renseignée${repondues > 1 ? "s" : ""}`;
  } else if (etat.ecran === 4) {
    btn.textContent = "Envoyer au tuteur";
    btn.disabled = !$("sa-presence").checked;
    sous.textContent = $("sa-presence").checked
      ? "Le tuteur recevra cette évaluation à valider"
      : "Confirmez la présence de l'étudiant pour envoyer";
  }
  $("sa-pied").hidden = (etat.ecran === 5);
}

$("sa-principal").addEventListener("click", async () => {
  if (etat.ecran === 0) return ouvrir();
  if (etat.ecran === 3) return preparerRecap();
  if (etat.ecran === 4) return envoyer();
});

/* ---------------------------------------------------------------- */
/* 0 — code du service                                               */
/* ---------------------------------------------------------------- */

$("sa-code").addEventListener("input", majPied);
$("sa-code").addEventListener("keydown", (e) => { if (e.key === "Enter") ouvrir(); });

async function ouvrir() {
  const err = $("sa-e0-err");
  err.hidden = true;
  if (!JETON) {
    err.textContent = "Lien incomplet : ouvrez l'évaluation depuis le lien fourni par le cadre.";
    err.hidden = false;
    return;
  }
  const btn = $("sa-principal");
  btn.disabled = true;
  btn.textContent = "Ouverture…";
  try {
    const code = $("sa-code").value.trim().toUpperCase();
    etat.contexte = await api("GET",
      `/api/saisie/contexte?jeton=${encodeURIComponent(JETON)}&code=${encodeURIComponent(code)}`);
    etat.code = code;
    afficherEtudiant();
    dessinerPros();
    // Nom retenu d'une saisie précédente sur cet appareil.
    const memo = Number(localStorage.getItem(CLE_PRO)) || 0;
    const connu = etat.contexte.professionnels.find((p) => p.id === memo);
    if (connu) { choisirPro(connu.id, connu.nom); return; }
    aller(1);
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
    majPied();
  }
}

function afficherEtudiant() {
  const e = etat.contexte.etudiant;
  $("sa-etudiant").hidden = false;
  $("sa-initiales").textContent = ((e.prenom[0] || "") + (e.initiale[0] || "")).toUpperCase();
  $("sa-nom").textContent = `${e.prenom} ${e.initiale}`.trim();
  $("sa-detail").textContent = [e.niveau, etat.contexte.service.nom].filter(Boolean).join(" · ");
}

/* ---------------------------------------------------------------- */
/* 1 — qui remplit                                                   */
/* ---------------------------------------------------------------- */

function dessinerPros() {
  const zone = $("sa-pros");
  zone.innerHTML = "";
  etat.contexte.professionnels.forEach((p) => {
    zone.appendChild(carte(p.nom, p.fonction, () => choisirPro(p.id, p.nom)));
  });
  zone.appendChild(carte("Autre — préciser", "Remplaçant, professionnel de passage", () => {
    const nom = prompt("Votre nom :");
    if (!nom || !nom.trim()) return;
    etat.proId = 0;
    etat.proNom = nom.trim();
    aller(2);
    dessinerGrilles();
  }));
  if (!etat.contexte.professionnels.length) {
    zone.insertBefore(
      texte("Aucun professionnel n'est enregistré dans ce service : utilisez « Autre — préciser »."),
      zone.firstChild);
  }
}

function choisirPro(id, nom) {
  etat.proId = id;
  etat.proNom = nom;
  try { localStorage.setItem(CLE_PRO, String(id)); } catch (e) { /* navigation privée */ }
  aller(2);
  dessinerGrilles();
}

/* ---------------------------------------------------------------- */
/* 2 — quel soin                                                     */
/* ---------------------------------------------------------------- */

function dessinerGrilles() {
  $("sa-e2-aide").textContent =
    `Grilles attendues pour ${etat.contexte.etudiant.prenom} sur ce stage.`;
  const zone = $("sa-grilles");
  zone.innerHTML = "";
  if (!etat.contexte.grilles.length) {
    zone.appendChild(texte("Aucune grille attendue sur ce stage pour le moment."));
    return;
  }
  etat.contexte.grilles.forEach((g) => {
    const complet = g.Faits >= g.Nb_attendu;
    const c = carte(g.Nom, complet ? "Déjà fait" : `${g.Faits} / ${g.Nb_attendu} observation(s)`,
      () => commencer(g));
    if (complet) c.classList.add("fait");
    zone.appendChild(c);
  });
}

function commencer(grille) {
  etat.grille = grille;
  etat.reponses = new Map();
  etat.uuid = uuidLocal();
  $("sa-contexte").value = "";
  $("sa-global").value = "";
  $("sa-presence").checked = false;
  restaurerBrouillon();
  $("sa-p-nom").textContent = grille.Nom;
  dessinerItems();
  aller(3);
}

/* ---------------------------------------------------------------- */
/* 3 — la grille                                                     */
/* ---------------------------------------------------------------- */

const questionsDeLaGrille = () =>
  (etat.grille ? etat.grille.items : []).filter((i) => i.Type !== "section");

const obligatoiresManquantes = () =>
  questionsDeLaGrille().filter((i) => i.Obligatoire && !(etat.reponses.get(i.id) || {}).valeur);

function dessinerItems() {
  const zone = $("sa-items");
  zone.innerHTML = "";
  etat.grille.items.forEach((item) => {
    if (item.Type === "section") {
      const h = document.createElement("div");
      h.className = "sa-grp";
      h.textContent = item.Libelle;
      zone.appendChild(h);
      return;
    }
    const bloc = document.createElement("div");
    bloc.className = "sa-item";
    const rep = etat.reponses.get(item.id) || {};
    if (rep.valeur) bloc.classList.add("repondu");

    const lib = document.createElement("div");
    lib.className = "sa-lib";
    lib.textContent = item.Libelle + (item.Obligatoire ? "" : " (facultatif)");
    bloc.appendChild(lib);
    if (item.Aide) {
      const p = document.createElement("div");
      p.className = "sa-precision";
      p.textContent = item.Aide;
      bloc.appendChild(p);
    }

    if (item.Type === "texte") {
      const t = document.createElement("textarea");
      t.maxLength = 500;
      t.placeholder = "Observation factuelle";
      t.value = rep.valeur || "";
      t.addEventListener("input", () => {
        majReponse(item.id, { valeur: t.value.slice(0, 40), commentaire: t.value });
        bloc.classList.toggle("repondu", !!t.value.trim());
      });
      bloc.appendChild(t);
    } else {
      const opts = ECHELLES[item.Type] || ECHELLES.acquisition;
      const grille = document.createElement("div");
      grille.className = "sa-opts" + (item.Type === "oui_non" ? " trio" : "");
      opts.forEach((o) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "sa-opt" + (o.cls ? " " + o.cls : "") + (rep.valeur === o.v ? " on" : "");
        b.textContent = o.t;
        b.addEventListener("click", () => {
          grille.querySelectorAll(".sa-opt").forEach((x) => x.classList.remove("on"));
          b.classList.add("on");
          bloc.classList.add("repondu");
          majReponse(item.id, { valeur: o.v });
        });
        grille.appendChild(b);
      });
      bloc.appendChild(grille);

      const btnCom = document.createElement("button");
      btnCom.type = "button";
      btnCom.className = "sa-com-btn";
      btnCom.textContent = rep.commentaire ? "Modifier le commentaire" : "+ Ajouter un commentaire";
      btnCom.addEventListener("click", () => {
        if (bloc.querySelector("textarea")) return;
        const t = document.createElement("textarea");
        t.maxLength = 500;
        t.placeholder = "Précision (lue par l'étudiant)";
        t.value = rep.commentaire || "";
        t.addEventListener("input", () => majReponse(item.id, { commentaire: t.value }));
        bloc.appendChild(t);
        btnCom.remove();
        t.focus();
      });
      bloc.appendChild(btnCom);
    }
    zone.appendChild(bloc);
  });
  majPied();
}

function majReponse(itemId, patch) {
  const actuel = etat.reponses.get(itemId) || {};
  etat.reponses.set(itemId, { ...actuel, ...patch });
  enregistrerBrouillon();
  majPied();
}

/* ---------------------------------------------------------------- */
/* Brouillon local : la seule parade aux zones blanches              */
/* ---------------------------------------------------------------- */

function cleBrouillon() {
  return `${CLE_BROUILLON}:${JETON}:${etat.grille ? etat.grille.formulaireId : 0}`;
}

function enregistrerBrouillon() {
  if (!etat.grille) return;
  try {
    localStorage.setItem(cleBrouillon(), JSON.stringify({
      uuid: etat.uuid,
      contexte: $("sa-contexte").value,
      global: $("sa-global").value,
      reponses: [...etat.reponses.entries()],
      le: Date.now(),
    }));
    $("sa-brouillon").hidden = false;
  } catch (e) { /* stockage indisponible : on continue sans filet */ }
}

function restaurerBrouillon() {
  try {
    const brut = localStorage.getItem(cleBrouillon());
    if (!brut) return;
    const d = JSON.parse(brut);
    // Un brouillon de plus de 7 jours n'a plus de sens et ne doit pas
    // traîner sur le téléphone personnel d'un soignant.
    if (!d || Date.now() - (d.le || 0) > 7 * 24 * 3600 * 1000) {
      localStorage.removeItem(cleBrouillon());
      return;
    }
    if (!confirm("Une saisie non envoyée existe pour ce soin. La reprendre ?")) {
      localStorage.removeItem(cleBrouillon());
      return;
    }
    etat.uuid = d.uuid || etat.uuid;
    etat.reponses = new Map(d.reponses || []);
    $("sa-contexte").value = d.contexte || "";
    $("sa-global").value = d.global || "";
    $("sa-brouillon").hidden = false;
  } catch (e) { /* brouillon illisible : on repart à vide */ }
}

function oublierBrouillon() {
  try { localStorage.removeItem(cleBrouillon()); } catch (e) { /* ignore */ }
  $("sa-brouillon").hidden = true;
}

/* ---------------------------------------------------------------- */
/* 4 — récapitulatif, lu avec l'étudiant                             */
/* ---------------------------------------------------------------- */

function preparerRecap() {
  const zone = $("sa-recap");
  zone.innerHTML = "";
  ligneRecap(zone, "Soin", etat.grille.Nom);
  ligneRecap(zone, "Évalué par", etat.proNom + (etat.proId ? "" : " (nom saisi)"));
  if ($("sa-contexte").value.trim()) ligneRecap(zone, "Situation", $("sa-contexte").value.trim());

  etat.grille.items.forEach((item) => {
    if (item.Type === "section") return;
    const rep = etat.reponses.get(item.id);
    if (!rep || (!rep.valeur && !rep.commentaire)) return;
    const valeur = item.Type === "texte"
      ? (rep.commentaire || "").slice(0, 60)
      : (LIBELLE_VALEUR[rep.valeur] || rep.valeur || "");
    const l = ligneRecap(zone, item.Libelle, valeur);
    if (item.Type !== "texte" && rep.commentaire) {
      const c = document.createElement("div");
      c.className = "sa-recap-com";
      c.textContent = "« " + rep.commentaire + " »";
      l.after(c);
    }
  });
  aller(4);
}

function ligneRecap(zone, libelle, valeur) {
  const l = document.createElement("div");
  l.className = "sa-recap-l";
  const g = document.createElement("span");
  g.textContent = libelle;
  const d = document.createElement("span");
  d.className = "v";
  d.textContent = valeur;
  l.append(g, d);
  zone.appendChild(l);
  return l;
}

$("sa-presence").addEventListener("change", majPied);

/* ---------------------------------------------------------------- */
/* Envoi                                                             */
/* ---------------------------------------------------------------- */

async function envoyer() {
  const btn = $("sa-principal");
  const err = $("sa-e4-err");
  err.hidden = true;
  btn.disabled = true;
  btn.textContent = "Envoi…";
  try {
    await api("POST", "/api/saisie/evaluation", {
      jeton: JETON,
      code: etat.code,
      formulaireId: etat.grille.formulaireId,
      professionnelId: etat.proId || undefined,
      auteurLibre: etat.proId ? undefined : etat.proNom,
      contexte: $("sa-contexte").value,
      commentaireGlobal: $("sa-global").value,
      presenceEtudiant: $("sa-presence").checked,
      reponses: [...etat.reponses.entries()].map(([itemId, r]) => ({
        itemId, valeur: r.valeur || "", commentaire: r.commentaire || "",
      })),
      uuid: etat.uuid,
    });
    oublierBrouillon();
    $("sa-fini-txt").textContent =
      `L'évaluation est enregistrée. Elle ne comptera pour ${etat.contexte.etudiant.prenom} `
      + "qu'une fois validée par son tuteur.";
    aller(5);
  } catch (e) {
    // Le brouillon reste : en zone blanche, l'envoi se rejoue sans ressaisie
    // et l'UUID empêche le doublon.
    err.textContent = e.message + " — votre saisie est conservée, réessayez.";
    err.hidden = false;
    btn.disabled = false;
    btn.textContent = "Envoyer au tuteur";
  }
}

$("sa-encore").addEventListener("click", async () => {
  try {
    etat.contexte = await api("GET",
      `/api/saisie/contexte?jeton=${encodeURIComponent(JETON)}&code=${encodeURIComponent(etat.code)}`);
  } catch (e) { /* on garde le contexte précédent */ }
  dessinerGrilles();
  aller(2);
});

/* ---------------------------------------------------------------- */
/* Utilitaires                                                       */
/* ---------------------------------------------------------------- */

function carte(nom, meta, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "sa-choix";
  const g = document.createElement("div");
  const n = document.createElement("div");
  n.className = "sa-nom";
  n.textContent = nom;
  g.appendChild(n);
  if (meta) {
    const m = document.createElement("div");
    m.className = "sa-meta";
    m.textContent = meta;
    g.appendChild(m);
  }
  const f = document.createElement("span");
  f.className = "sa-fleche";
  f.textContent = "›";
  b.append(g, f);
  b.addEventListener("click", onClick);
  return b;
}

function texte(t) {
  const p = document.createElement("p");
  p.className = "sa-aide";
  p.textContent = t;
  return p;
}

/** UUID généré côté client AVANT l'envoi : c'est lui qui rend un renvoi
 *  après coupure réseau idempotent. */
function uuidLocal() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/* Démarrage */
if (!JETON) {
  $("sa-e0-err").textContent =
    "Lien incomplet : ouvrez l'évaluation depuis le lien ou le QR code fourni par le cadre.";
  $("sa-e0-err").hidden = false;
}
aller(0);

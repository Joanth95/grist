/* Espace étudiant — consultation du planning + déclarations d'heures */
/* © Joan Thuillier — Tous droits réservés. Voir LICENSE à la racine du dépôt. */

const API = window.CONFIG.API_URL.replace(/\/$/, "");
const $ = (id) => document.getElementById(id);
const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

// Lien direct (#code=...&email=...) : permet d'ouvrir l'espace sans ressaisir
// ses identifiants (ex. lien fourni depuis Grist). L'e-mail est le 2ᵉ facteur
// exigé par le Worker dès que le dossier en porte un : un lien qui ne
// transporte que le code laisse l'étudiant le saisir lui-même.
//
// Lus dans le FRAGMENT : contrairement à la query string, il n'est pas envoyé
// au serveur, donc pas journalisé par l'hébergeur. L'ancienne forme
// « ?code=... » reste acceptée pour les liens déjà distribués.
const urlParams = new URLSearchParams(
  location.hash.length > 1 ? location.hash.slice(1) : location.search.slice(1));
const urlCode = urlParams.get("code");
const urlEmail = urlParams.get("email");
if (urlCode) {
  history.replaceState(null, "", location.pathname);
  const el = document.getElementById("login-code");
  if (el) el.value = urlCode.trim().toUpperCase();
  const emailEl = document.getElementById("login-email");
  if (emailEl && urlEmail) emailEl.value = urlEmail.trim();
  // Le formulaire n'est plus le premier bloc de la page d'accueil : quand il
  // est hors écran (affichage empilé), on amène directement dessus. Rejoué au
  // "load" car les polices et le logo de l'établissement, chargés après coup,
  // déplacent la cible ; sans effet si le bloc est déjà à l'écran.
  const amenerAuFormulaire = () => {
    const bloc = document.getElementById("connexion");
    if (bloc && bloc.getBoundingClientRect().top > window.innerHeight * 0.6) {
      bloc.scrollIntoView();
    }
  };
  amenerAuFormulaire();
  window.addEventListener("load", amenerAuFormulaire);
  // Le lien porte l'e-mail : il ne reste qu'à valider, on vise le bouton.
  // Sinon c'est le champ e-mail qui manque : on y met le curseur.
  const cible = urlEmail ? document.getElementById("login-btn") : emailEl;
  if (cible) cible.focus({ preventScroll: true });
}

const state = {
  code: sessionStorage.getItem("code") || null,
  email: sessionStorage.getItem("email") || null,
  data: null, // { etudiant, motifs, periodes, semaines, codes, sorties }
  selectedPeriodeId: null, // période affichée (onglet actif)
};

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(state.code ? { "X-Student-Code": state.code } : {}),
      ...(state.email ? { "X-Student-Email": state.email } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

/* ------------------------------------------------------------------ */
/* Connexion                                                           */
/* ------------------------------------------------------------------ */

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("login-btn");
  const errEl = $("login-error");
  errEl.hidden = true;
  btn.disabled = true;
  btn.textContent = "Connexion…";
  try {
    state.code = $("login-code").value.trim().toUpperCase();
    state.email = $("login-email").value.trim();
    state.data = await api("POST", "/api/login", { code: state.code, email: state.email });
    sessionStorage.setItem("code", state.code);
    if (state.email) sessionStorage.setItem("email", state.email);
    else sessionStorage.removeItem("email");
    enterApp();
  } catch (err) {
    state.code = null;
    state.email = null;
    errEl.textContent = err.message;
    errEl.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "Se connecter";
  }
});

$("logout-btn").addEventListener("click", () => {
  sessionStorage.clear();
  location.reload();
});

// Impression / export PDF du récapitulatif affiché
$("print-btn").addEventListener("click", () => window.print());

function enterApp() {
  $("login-screen").hidden = true;
  $("app-screen").hidden = false;
  const e = state.data.etudiant;
  $("student-name").textContent = `${e.prenom} ${e.nom}`.trim();
  renderStudentContact();
  render();
}

/* ---------- Mes coordonnées (téléphone, e-mail) ---------- */

function renderStudentContact() {
  const e = state.data.etudiant;
  const container = $("student-contact");
  container.innerHTML = "";
  const parts = [e.telephone, e.email].filter(Boolean);
  if (parts.length) container.append(document.createTextNode(parts.join(" · ") + " "));
  const editBtn = el("button", "btn-link", "Modifier mes coordonnées");
  editBtn.type = "button";
  editBtn.addEventListener("click", openProfilDialog);
  container.appendChild(editBtn);
}

const profilDialog = $("profil-dialog");

function openProfilDialog() {
  const e = state.data.etudiant;
  $("profil-tel").value = e.telephone || "";
  $("profil-email").value = e.email || "";
  // L'e-mail du dossier est le 2ᵉ facteur : seul celui qui l'a prouvé à la
  // connexion peut le changer. Sur un dossier qui n'en porte pas encore, le
  // champ reste en lecture seule — sinon le premier venu qui devine le code
  // y mettrait le sien et priverait l'étudiant de son dossier.
  const emailEl = $("profil-email");
  const modifiable = e.emailModifiable !== false;
  emailEl.readOnly = !modifiable;
  const note = $("profil-email-note");
  if (note) {
    note.textContent = modifiable
      ? "Votre e-mail sert de 2ᵉ facteur à la connexion : si vous le changez, "
        + "vous devrez saisir la nouvelle adresse la prochaine fois."
      : "L'adresse e-mail de votre dossier sert de 2ᵉ facteur à la connexion : "
        + "elle ne peut pas être ajoutée ni modifiée ici. Demandez-le à votre cadre de santé.";
  }
  $("profil-error").hidden = true;
  profilDialog.showModal();
}

$("profil-cancel-btn").addEventListener("click", () => profilDialog.close());

$("profil-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = $("profil-error");
  errEl.hidden = true;

  const telephone = $("profil-tel").value.trim();
  const email = $("profil-email").value.trim();

  const btn = $("profil-save-btn");
  btn.disabled = true;
  try {
    await api("PATCH", "/api/profil", { Numero_de_telephone: telephone, Adresse_mail: email });
    // L'e-mail sert de 2ᵉ facteur à chaque requête : on met à jour la session
    // pour rester authentifié après un changement.
    state.email = email;
    if (email) sessionStorage.setItem("email", email);
    else sessionStorage.removeItem("email");
    profilDialog.close();
    await refresh();
    renderStudentContact();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

async function refresh() {
  state.data = await api("GET", "/api/data");
  render();
}

/* ------------------------------------------------------------------ */
/* Rendu                                                               */
/* ------------------------------------------------------------------ */

// Période affichée par défaut : celle en cours, sinon la plus récente
function defaultPeriode() {
  const p = state.data.periodes;
  return p.find((x) => x.En_cours) || p[p.length - 1] || null;
}

// Période actuellement sélectionnée (onglet actif)
function currentPeriode() {
  const p = state.data.periodes;
  return p.find((x) => x.id === state.selectedPeriodeId) || defaultPeriode();
}

function render() {
  // Fixe l'onglet actif au premier affichage / si la sélection n'existe plus
  if (!state.data.periodes.some((p) => p.id === state.selectedPeriodeId)) {
    const def = defaultPeriode();
    state.selectedPeriodeId = def ? def.id : null;
  }
  renderTabs();
  renderPeriode();
  renderToday();
  renderRdvs();
  renderSorties();
  renderWeeks();
}

/* ---------- Mon planning du jour ---------- */

/** Journée d'aujourd'hui dans le planning : la semaine qui contient la date,
 *  le code horaire posé dessus et les heures comptées. Cherchée sur toutes les
 *  périodes : l'encart répond à « qu'est-ce que je fais aujourd'hui ? », il ne
 *  suit donc pas l'onglet affiché. */
function jourDuPlanning(iso) {
  for (const s of state.data.semaines) {
    if (!s.Semaine_debut) continue;
    const i = Math.round(
      (Date.parse(iso + "T00:00:00") - Date.parse(s.Semaine_debut + "T00:00:00")) / 86400000);
    if (i < 0 || i > 6) continue;
    return {
      semaine: s,
      code: state.data.codes.find((c) => c.id === s[DAYS[i]]) || null,
      info: (s.jours && s.jours[i]) || { heures: 0, ferie: false },
    };
  }
  return null;
}

/** Période à laquelle rattacher la journée : celle de la semaine trouvée,
 *  sinon celle qui couvre la date, sinon le stage marqué en cours. */
function periodeDuJour(iso, jour) {
  const periodes = state.data.periodes;
  return (jour && periodes.find((p) => p.id === jour.semaine.Periode))
    || periodes.find((p) => p.Du && p.Au && p.Du <= iso && iso <= p.Au)
    || periodes.find((p) => p.En_cours)
    || null;
}

/** Encart d'accueil : horaires du jour, rendez-vous et déclarations du jour,
 *  puis rappel du solde d'heures du stage. */
function renderToday() {
  const section = $("today-section");
  const container = $("today");
  container.innerHTML = "";

  const today = isoDate(new Date());
  const jour = jourDuPlanning(today);
  const rdvs = (state.data.rdvs || []).filter((r) => r.Date_rdv === today);
  const sorties = state.data.sorties.filter((s) => s.Date === today);
  const p = periodeDuJour(today, jour);

  // Hors stage : ni journée planifiée, ni rendez-vous, ni période à rappeler —
  // l'encart n'aurait rien à dire, on le masque plutôt que d'afficher du vide.
  if (!jour && !rdvs.length && !sorties.length && !p) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  const card = el("div", "today-card");

  const tete = el("div", "today-head");
  tete.appendChild(el("div", "today-date", longDate(today)));
  if (p) tete.appendChild(el("div", "today-service", p.Service || "Stage"));
  card.appendChild(tete);

  card.appendChild(renderTodayJournee(jour));

  if (rdvs.length) card.appendChild(todayBloc("Rendez-vous du jour", rdvs.map(todayRdvLigne)));
  if (sorties.length) card.appendChild(todayBloc("Mes déclarations du jour", sorties.map(todaySortieLigne)));

  if (p && p.A_FAIRE != null) {
    const bilan = el("div", "today-bilan");
    bilan.append(...badgesAvancement(p));
    card.appendChild(bilan);
  }

  container.appendChild(card);
}

/** Ligne principale de l'encart : le code horaire du jour, son libellé et son
 *  créneau. Sans code posé, on le dit — une case vide se lit mal. */
function renderTodayJournee(jour) {
  const ligne = el("div", "today-journee");
  const code = jour && jour.code;
  if (!code) {
    ligne.classList.add("repos");
    ligne.appendChild(el("span", "", jour
      ? "Repos : aucun horaire n'est posé sur cette journée."
      : "Aucune journée de stage planifiée aujourd'hui."));
    return ligne;
  }

  ligne.appendChild(el("span", "today-code", code.Code));
  const corps = el("div", "today-journee-corps");
  if (code.Libelle) corps.appendChild(el("div", "today-libelle", code.Libelle));
  if (code.Heure_debut && code.Heure_fin) {
    corps.appendChild(el("div", "today-horaires", `${code.Heure_debut} – ${code.Heure_fin}`));
  }
  ligne.appendChild(corps);

  const marques = el("div", "today-marques");
  if (jour.info.heures > 0) marques.appendChild(badge(`${formatH(jour.info.heures)} comptées`, "ok"));
  if (jour.info.ferie) marques.appendChild(badge("jour férié", "pending"));
  if (jour.info.recup) marques.appendChild(badge("récup férié", "ok"));
  if (marques.childElementCount) ligne.appendChild(marques);
  return ligne;
}

/** Sous-bloc de l'encart : un intitulé, puis les lignes qu'on lui donne. */
function todayBloc(titre, lignes) {
  const bloc = el("div", "today-bloc");
  bloc.appendChild(el("h3", "today-bloc-titre", titre));
  for (const ligne of lignes) bloc.appendChild(ligne);
  return bloc;
}

function todayRdvLigne(r) {
  const item = el("div", "today-item");
  item.appendChild(el("span", "today-item-titre", r.Type_de_rendez_vous || "Rendez-vous"));
  const details = [];
  if (r.Formateur) details.push("avec " + r.Formateur);
  if (r.Precision) details.push(r.Precision);
  if (details.length) item.appendChild(el("span", "today-item-meta", details.join(" · ")));
  return item;
}

function todaySortieLigne(s) {
  const item = el("div", "today-item");
  const adj = s.Valide ? s.Ajustement_h : expectedAdjustment(s);
  item.appendChild(el("span", "today-item-titre", s.Motif || "(sans motif)"));
  item.appendChild(el("span", "today-item-meta",
    `${s.Heure_debut || "?"} – ${s.Heure_fin || "?"} · ${adj > 0 ? "+" : ""}${formatH(adj)}`));
  item.appendChild(badge(s.Valide ? "Validé" : "En attente", s.Valide ? "ok" : "pending"));
  return item;
}

/** Avancement d'une période : effectuées / à réaliser / solde. Partagé par la
 *  carte de période et l'encart du jour, pour qu'ils ne divergent jamais. */
function badgesAvancement(p) {
  const badges = [
    badge(`${formatH(p.FAIT ?? 0)} effectuées`, "ok"),
    badge(`${formatH(p.A_FAIRE)} à réaliser`, ""),
  ];
  if (p.Solde_heures != null) {
    badges.push(badge(`Solde : ${p.Solde_heures > 0 ? "+" : ""}${formatH(p.Solde_heures)}`,
      p.Solde_heures >= 0 ? "ok" : "warn"));
  }
  return badges;
}

/* ---------- Rendez-vous du stage ---------- */

/** Rendez-vous de la période affichée : à venir d'abord, puis les passés,
 *  grisés. La section reste masquée tant qu'il n'y en a aucun — un stage sans
 *  rendez-vous n'a pas besoin d'un bloc vide. */
function renderRdvs() {
  const section = $("rdvs-section");
  const container = $("rdvs");
  container.innerHTML = "";
  const p = currentPeriode();
  const rdvs = (state.data.rdvs || [])
    .filter((r) => p && r.Periode === p.id && r.Date_rdv)
    .sort((a, b) => a.Date_rdv.localeCompare(b.Date_rdv));
  section.hidden = !rdvs.length;
  if (!rdvs.length) return;

  const today = isoDate(new Date());
  for (const r of rdvs) {
    const passe = r.Date_rdv < today;
    const ligne = el("div", "rdv-item" + (passe ? " passe" : ""));

    const date = el("div", "rdv-date", frDate(r.Date_rdv));
    ligne.appendChild(date);

    const corps = el("div", "rdv-corps");
    const titre = el("div", "rdv-titre", r.Type_de_rendez_vous || "Rendez-vous");
    if (!passe) titre.appendChild(badge("à venir", "ok"));
    corps.appendChild(titre);

    const details = [];
    if (r.Formateur) details.push("avec " + r.Formateur);
    if (r.Precision) details.push(r.Precision);
    if (details.length) corps.appendChild(el("div", "rdv-meta", details.join(" · ")));
    ligne.appendChild(corps);
    container.appendChild(ligne);
  }
}

function renderTabs() {
  const container = $("periode-tabs");
  container.innerHTML = "";
  const periodes = state.data.periodes;
  if (periodes.length <= 1) return; // pas d'onglets pour une seule période

  const tabs = [...periodes].sort((a, b) => (a.Du || "").localeCompare(b.Du || ""));
  for (const p of tabs) {
    const tab = el("button", "periode-tab" + (p.id === state.selectedPeriodeId ? " active" : ""));
    tab.appendChild(el("span", "tab-service", p.Service || "Stage"));
    const meta = el("span", "tab-dates", shortDate(p.Du) + " – " + shortDate(p.Au));
    if (p.En_cours) meta.appendChild(badge("en cours", "ok"));
    tab.appendChild(meta);
    tab.addEventListener("click", () => {
      state.selectedPeriodeId = p.id;
      render();
    });
    container.appendChild(tab);
  }
}

function renderPeriode() {
  const container = $("periode-info");
  container.innerHTML = "";
  const p = currentPeriode();
  if (!p) {
    container.appendChild(el("p", "empty", "Aucune période de stage enregistrée. Contactez votre encadrant."));
    return;
  }

  const card = el("div", "periode-card");
  card.appendChild(el("div", "periode-service", p.Service || "Stage"));
  card.appendChild(el("div", "periode-dates",
    `Du ${frDate(p.Du)} au ${frDate(p.Au)}` +
    (p.Niveau ? ` · ${p.Niveau}` : "") +
    (p.Tuteur ? ` · Tuteur : ${p.Tuteur}` : "")));

  if (p.A_FAIRE != null) {
    const stats = el("div", "periode-stats");
    stats.append(...badgesAvancement(p));
    if (p.Recuperation > 0) {
      stats.appendChild(badge(`${p.Recuperation} jour${p.Recuperation > 1 ? "s" : ""} de récupération à poser`, "ok"));
    }
    if (p.Absences > 0) {
      stats.appendChild(badge(`${p.Absences} jour${p.Absences > 1 ? "s" : ""} d'absence`, "warn"));
    }
    if (p.Presence_pct != null && p.Presence_pct < 80) {
      stats.appendChild(badge(`Présence ${p.Presence_pct} % (minimum 80 %)`, "warn"));
    }
    if ((state.data.absences_cursus || 0) > 30) {
      stats.appendChild(badge(`Franchise d'absences dépassée (${state.data.absences_cursus}/30 j)`, "warn"));
    }
    card.appendChild(stats);
  }

  if (p.cadre && p.cadre.nom) {
    card.appendChild(renderCadre(p.cadre));
  }
  const rdv = renderRdvInvite(p);
  if (rdv) card.appendChild(rdv);
  const invite = renderEvaluationInvite(p);
  if (invite) card.appendChild(invite);
  container.appendChild(card);
}

/** Prise de rendez-vous sur RDV Service Public : proposée tant que le stage
 *  n'est pas terminé, quand l'administrateur a activé le raccordement et
 *  renseigné l'adresse de la page de réservation (voir etablissement.js). */
function renderRdvInvite(p) {
  const cfg = window.ETAB_CONFIG || {};
  // Le lien vient de Grist : le Worker ne laisse passer que du http(s), on le
  // revérifie ici puisque le cache local peut être plus ancien.
  if (!cfg.rdvSpActif || !/^https?:\/\//i.test(cfg.rdvSpUrl || "")) return null;
  if (stageTermine(p)) return null;

  const wrap = el("div", "periode-rdv");
  const a = el("a", "btn btn-secondary", "📅 Prendre rendez-vous");
  a.href = cfg.rdvSpUrl;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  wrap.appendChild(a);
  wrap.appendChild(el("p", "eval-note",
    "Entretien de suivi, bilan de mi-stage : réservez un créneau sur RDV Service Public. "
    + "Le rendez-vous se range ensuite tout seul dans votre dossier de stage."));
  return wrap;
}

// La config de l'établissement arrive après coup (etablissement.js) : si
// l'espace est déjà affiché, on rejoue le rendu pour faire apparaître — ou
// disparaître — le bouton de prise de rendez-vous.
document.addEventListener("etab-config", () => {
  if (state.data) render();
});

/** Un stage est terminé le lendemain de sa date de fin — sauf si le service le
 *  maintient « en cours ». Sert au questionnaire comme aux déclarations. */
function stageTermine(p) {
  return !!p && !p.En_cours && !!p.Au && p.Au < isoDate(new Date());
}

/** Jours écoulés depuis la fin du stage (négatif s'il n'est pas fini). */
function joursDepuisFin(p) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((today - new Date(p.Au + "T00:00:00")) / 86400000);
}

/** Le questionnaire de satisfaction ne s'ouvre qu'une fois le stage terminé,
 *  et reste accessible 40 jours (au-delà, le cadre relance par mail). */
function evaluationOuverte(p) {
  return stageTermine(p) && joursDepuisFin(p) <= 40;
}

/** Accès au questionnaire de satisfaction de fin de stage, sur la période
 *  affichée : bouton tant qu'il n'a pas été rempli, remerciement ensuite. */
function renderEvaluationInvite(p) {
  const lien = p.Lien_evaluation || "";
  // Le lien vient de Grist : on n'ouvre que du http(s), jamais un javascript:.
  if (!/^https?:\/\//i.test(lien)) return null;

  const wrap = el("div", "periode-eval");
  if (p.Evaluation_repondue) {
    wrap.appendChild(el("p", "eval-note",
      "✅ Questionnaire de satisfaction : merci, votre réponse a bien été enregistrée."));
    return wrap;
  }
  if (!evaluationOuverte(p)) return null;

  const a = el("a", "btn btn-primary", "📝 Compléter le questionnaire de satisfaction");
  a.href = lien;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  wrap.appendChild(a);
  wrap.appendChild(el("p", "eval-note",
    "Quelques minutes suffisent. Vos réponses sont dépouillées de façon anonyme et aident à améliorer l'accueil des prochains étudiants."));
  return wrap;
}

/** Bloc coordonnées du cadre du service (nom, email, téléphone). */
function renderCadre(cadre) {
  const wrap = el("div", "periode-cadre");
  wrap.appendChild(el("span", "cadre-label", "Cadre du service : "));
  wrap.appendChild(el("strong", "", cadre.nom));
  if (cadre.telephone) {
    const a = el("a", "cadre-link", `☎ ${cadre.telephone}`);
    a.href = "tel:" + cadre.telephone.replace(/\s/g, "");
    wrap.append(document.createTextNode(" · "), a);
  }
  if (cadre.email) {
    const a = el("a", "cadre-link", `✉ ${cadre.email}`);
    a.href = "mailto:" + cadre.email;
    wrap.append(document.createTextNode(" · "), a);
  }
  return wrap;
}

/* ---------- Déclarations (sorties de stage) ---------- */

function renderSorties() {
  const container = $("sorties");
  container.innerHTML = "";
  const p = currentPeriode();
  const isDefault = p && defaultPeriode() && p.id === defaultPeriode().id;

  // Stage terminé : plus rien à déclarer (le serveur refuse aussi). Les
  // déclarations déjà saisies restent consultables.
  const fini = stageTermine(p);
  $("add-sortie-btn").hidden = fini;
  $("sortie-closed-note").hidden = !fini;

  // Déclarations de la période sélectionnée ; celles sans période rattachée
  // apparaissent sous la période par défaut.
  const sorties = state.data.sorties
    .filter((s) => s.Periode === (p && p.id) || (!s.Periode && isDefault))
    .sort((a, b) => (b.Date || "").localeCompare(a.Date || ""));

  if (!sorties.length) {
    container.appendChild(el("p", "empty", "Aucune déclaration pour cette période."));
    return;
  }

  for (const s of sorties) {
    const row = el("div", "sortie-row");

    // Heures affichées : réelles si validé, prévues sinon
    const adj = s.Valide ? s.Ajustement_h : expectedAdjustment(s);
    const sign = adj > 0 ? "+" : "";
    const badgeEl = badge(`${sign}${formatH(adj)}`,
      s.Valide ? (adj > 0 ? "ok" : (adj < 0 ? "warn" : "")) : "");
    badgeEl.classList.add("sortie-hours");

    const main = el("div", "sortie-main");
    // Affiche le motif tel qu'enregistré dans Grist, sans traduction
    const label = s.Motif || "(sans motif)";
    const titleText = s.Commentaire ? `${label} — ${s.Commentaire}` : label;
    const title = el("div", "sortie-title", titleText);
    title.appendChild(badge(s.Valide ? "Validé" : "En attente", s.Valide ? "ok" : "pending"));
    main.appendChild(title);
    main.appendChild(el("div", "sortie-meta",
      `${frDate(s.Date)} · ${s.Heure_debut || "?"} – ${s.Heure_fin || "?"}`));

    row.append(badgeEl, main);

    if (!s.Valide) {
      const delBtn = el("button", "sortie-delete", "🗑️");
      delBtn.title = "Supprimer cette déclaration";
      delBtn.addEventListener("click", () => removeSortie(s));
      row.appendChild(delBtn);
    }
    container.appendChild(row);
  }
}

/** Heures qu'une déclaration en attente vaudra une fois validée. */
function expectedAdjustment(s) {
  const d = s.Duree_heures || 0;
  if ((s.Motif || "").trim().toUpperCase() === "RETARD") return -d;
  return s.Compte_stage ? d : 0;
}

async function removeSortie(s) {
  if (!confirm(`Supprimer la déclaration « ${s.Motif} » du ${frDate(s.Date)} ?`)) return;
  try {
    await api("DELETE", `/api/sorties/${s.id}`);
    await refresh();
  } catch (err) {
    alert(err.message);
  }
}

/* ---------- Planning (lecture seule) ---------- */

function renderWeeks() {
  const container = $("weeks");
  container.innerHTML = "";
  const p = currentPeriode();
  if (!p) return;

  const codeById = new Map(state.data.codes.map((c) => [c.id, c]));
  const weeks = state.data.semaines
    .filter((s) => s.Periode === p.id)
    .sort((a, b) => (a.Semaine_debut || "").localeCompare(b.Semaine_debut || ""));

  if (!weeks.length) {
    container.appendChild(el("p", "empty", "Le planning n'a pas encore été établi par le service."));
    return;
  }

  const todayIso = isoDate(new Date());
  for (const week of weeks) {
    const card = el("section", "week-card");

    const header = el("div", "week-header");
    header.appendChild(el("h3", "", `Semaine du ${frDate(week.Semaine_debut)}`));
    if (week.Total_h_semaine != null) {
      header.appendChild(el("span", "week-total", formatH(week.Total_h_semaine)));
    }
    card.appendChild(header);

    const grid = el("div", "week-grid");
    DAYS.forEach((day, i) => {
      const dayIso = addDaysIso(week.Semaine_debut, i);
      const code = codeById.get(week[day]);
      const info = (week.jours && week.jours[i]) || { heures: 0, ferie: false };
      const cell = el("div", "day-cell readonly"
        + (dayIso === todayIso ? " today" : "")
        + (info.ferie ? " ferie" : "")
        + (info.recup ? " recup" : ""));

      const label = el("div", "day-label", `${day.slice(0, 3)}. ${dayNum(dayIso)}`);
      if (info.ferie) label.appendChild(el("span", "ferie-tag", "férié"));
      if (info.recup) label.appendChild(el("span", "recup-tag", "récup férié"));
      cell.appendChild(label);

      const chip = el("div", "day-chip", code ? code.Code : "—");
      if (code) chip.title = code.Libelle + (code.Heure_debut && code.Heure_fin ? ` (${code.Heure_debut}–${code.Heure_fin})` : "");
      cell.appendChild(chip);

      // Créneau ET heures comptées : le créneau n'apparaissait qu'en infobulle
      // dès qu'une journée comptait des heures, alors que c'est l'information
      // que l'étudiant vient chercher. Les deux bornes sont dans des <span>
      // séparés pour pouvoir passer à la ligne sur écran étroit.
      if (code && code.Heure_debut && code.Heure_fin) {
        const time = el("div", "day-time");
        time.appendChild(el("span", "", code.Heure_debut));
        time.appendChild(el("span", "day-time-sep", "–"));
        time.appendChild(el("span", "", code.Heure_fin));
        cell.appendChild(time);
      }
      if (info.heures > 0) {
        cell.appendChild(el("div", "day-hours", formatH(info.heures)));
      }
      grid.appendChild(cell);
    });
    card.appendChild(grid);

    if (week.Commentaire) {
      card.appendChild(el("p", "week-comment", week.Commentaire));
    }
    container.appendChild(card);
  }
}

/* ------------------------------------------------------------------ */
/* Dialogue de déclaration                                             */
/* ------------------------------------------------------------------ */

const dialog = $("sortie-dialog");

function selectedType() {
  return document.querySelector('input[name="sortie-type"]:checked').value;
}

// Aide à la saisie du motif selon le type choisi
const MOTIF_PLACEHOLDER = {
  "Rattrapage": "Ex. : heures rendues, remplacement…",
  "Retard": "Ex. : transport, empêchement…",
  "Sortie de stage": "Ex. : IFSI, AFGSU, regroupement…",
};

function syncTypeUI() {
  const type = selectedType();
  // La case « compte en temps de stage » ne concerne que la sortie de stage
  // (heures sup comptent toujours, retard déduit toujours).
  $("sortie-compte-wrap").hidden = type !== "Sortie de stage";
  $("sortie-motif-texte").placeholder = MOTIF_PLACEHOLDER[type] || "Précisez si besoin";
}

$("add-sortie-btn").addEventListener("click", () => {
  document.querySelector('input[name="sortie-type"][value="Rattrapage"]').checked = true;
  $("sortie-motif-texte").value = "";
  $("sortie-compte").checked = true;
  $("sortie-date").value = isoDate(new Date());
  $("sortie-debut").value = "";
  $("sortie-fin").value = "";
  $("sortie-error").hidden = true;
  syncTypeUI();
  dialog.showModal();
});

for (const radio of document.querySelectorAll('input[name="sortie-type"]')) {
  radio.addEventListener("change", syncTypeUI);
}

$("sortie-cancel-btn").addEventListener("click", () => dialog.close());

$("sortie-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = $("sortie-error");
  errEl.hidden = true;

  const type = selectedType();
  // Le type reste dans Motif (la formule Grist déduit les retards en testant
  // « RETARD ») ; la précision libre va dans Commentaire.
  let compte = true;
  if (type === "Retard") compte = false;
  if (type === "Sortie de stage") compte = $("sortie-compte").checked;

  const body = {
    Motif: type,
    Commentaire: $("sortie-motif-texte").value.trim(),
    Date: $("sortie-date").value,
    Heure_debut: $("sortie-debut").value,
    Heure_fin: $("sortie-fin").value,
    Compte_stage: compte,
  };

  const btn = $("sortie-save-btn");
  btn.disabled = true;
  try {
    await api("POST", "/api/sorties", body);
    dialog.close();
    await refresh();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

/* ------------------------------------------------------------------ */
/* Dialogue de nouvelle période de stage                               */
/* ------------------------------------------------------------------ */

const periodeDialog = $("periode-dialog");
let refData = null; // { services, niveaux }, chargés à la demande (première ouverture du dialogue)

async function loadRefData() {
  if (refData) return refData;
  const res = await fetch(API + "/api/services");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Erreur de chargement");
  refData = data;
  return refData;
}

function fillPeriodeSitesEtServices(services) {
  const siteSelect = $("periode-site");
  siteSelect.innerHTML = "";
  siteSelect.appendChild(new Option("— Choisir —", ""));
  const sites = [...new Set(services.map((s) => s.Site || "Autre"))].sort((a, b) => a.localeCompare(b, "fr"));
  for (const site of sites) siteSelect.appendChild(new Option(site, site));
  fillPeriodeServicesForSite("");
}

function fillPeriodeServicesForSite(site) {
  const select = $("periode-service");
  select.innerHTML = "";
  if (!site) {
    select.appendChild(new Option("— Choisissez d'abord un site —", ""));
    select.disabled = true;
    return;
  }
  const forSite = refData.services.filter((s) => (s.Site || "Autre") === site);
  select.disabled = false;
  select.appendChild(new Option("— Choisir —", ""));
  for (const s of forSite) select.appendChild(new Option(s.Nom, s.id));
}

// Niveau de la période la plus récente de l'étudiant (ex. L1 → L2 en cours de cursus)
function dernierNiveauConnu() {
  const periodes = (state.data && state.data.periodes) || [];
  if (!periodes.length) return "";
  return periodes.slice().sort((a, b) => (b.Du || "").localeCompare(a.Du || ""))[0].Niveau || "";
}

function fillPeriodeNiveaux(niveaux) {
  const select = $("periode-niveau");
  select.innerHTML = "";
  select.appendChild(new Option("— Choisir —", ""));
  for (const n of niveaux) select.appendChild(new Option(n, n));
  const dernierNiveau = dernierNiveauConnu();
  if (dernierNiveau) select.value = dernierNiveau;
}

$("periode-site").addEventListener("change", () => fillPeriodeServicesForSite($("periode-site").value));

$("add-periode-btn").addEventListener("click", async () => {
  const errEl = $("periode-error");
  errEl.hidden = true;
  $("periode-du").value = "";
  $("periode-au").value = "";
  periodeDialog.showModal();
  try {
    const ref = await loadRefData();
    fillPeriodeSitesEtServices(ref.services);
    fillPeriodeNiveaux(ref.niveaux);
  } catch (err) {
    errEl.textContent = "Impossible de charger la liste des services : " + err.message;
    errEl.hidden = false;
  }
});

$("periode-cancel-btn").addEventListener("click", () => periodeDialog.close());

$("periode-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = $("periode-error");
  errEl.hidden = true;

  const du = $("periode-du").value;
  const au = $("periode-au").value;
  if (du && au && au < du) {
    errEl.textContent = "La fin du stage doit être après le début.";
    errEl.hidden = false;
    return;
  }

  const body = {
    Service: Number($("periode-service").value),
    Niveau: $("periode-niveau").value,
    Du: du,
    Au: au,
  };

  const btn = $("periode-save-btn");
  btn.disabled = true;
  try {
    await api("POST", "/api/periodes", body);
    periodeDialog.close();
    await refresh();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

/* ------------------------------------------------------------------ */
/* Utilitaires                                                         */
/* ------------------------------------------------------------------ */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function badge(text, kind) {
  return el("span", "badge " + kind, text);
}

function isoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDaysIso(iso, n) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

function dayNum(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function frDate(iso) {
  if (!iso) return "?";
  return new Date(iso + "T00:00:00").toLocaleDateString("fr-FR", {
    day: "numeric", month: "long", year: "numeric",
  });
}

// « Vendredi 8 août 2026 » : l'encart du jour nomme le jour de la semaine,
// c'est ce qui permet de vérifier d'un coup d'œil qu'on lit la bonne journée.
function longDate(iso) {
  const s = new Date(iso + "T00:00:00").toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function shortDate(iso) {
  if (!iso) return "?";
  return new Date(iso + "T00:00:00").toLocaleDateString("fr-FR", {
    day: "numeric", month: "short", year: "2-digit",
  });
}

// Convertit un nombre d'heures décimal en format « 7h30 » (et non 7,5 h)
function formatH(hours) {
  if (hours == null) return "0h";
  const neg = hours < 0;
  const totalMin = Math.round(Math.abs(hours) * 60);
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  return (neg ? "-" : "") + hh + "h" + (mm ? String(mm).padStart(2, "0") : "");
}

/* ------------------------------------------------------------------ */
/* Démarrage                                                           */
/* ------------------------------------------------------------------ */

if (state.code) {
  // ?vue=1 : ouverture de l'espace (journalisée). Les refresh() qui suivent une
  // action appellent /api/data sans ce marqueur : l'action est déjà tracée.
  api("GET", "/api/data?vue=1")
    .then((data) => { state.data = data; enterApp(); })
    .catch(() => { sessionStorage.clear(); state.code = null; });
}

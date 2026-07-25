/* Espace administrateur — comptes des cadres */
/* © Joan Thuillier — Tous droits réservés. Voir LICENSE à la racine du dépôt. */

/* Premier écran de l'espace d'administration : il reprend ce qui se faisait à
   la main dans le document Grist (créer un cadre, le rattacher à ses services,
   réinitialiser un PIN, débloquer un compte, régénérer un code d'accès).

   Connexion : la même que l'espace cadre (email + code d'accès + PIN, endpoint
   /api/cadre/login) et le même jeton de session — seuls les comptes dont la
   case UTILISATEURS.Administrateur est cochée passent la porte. Le contrôle
   qui compte est côté Worker : ici, on n'affiche que ce qui est autorisé. */

const APP_VERSION = "v1"; // à incrémenter à chaque mise à jour (cf. ?v= dans espace-admin.html)
const API = window.CONFIG.API_URL.replace(/\/$/, "");
const $ = (id) => document.getElementById(id);

const state = {
  // Comme dans l'espace cadre : seul le jeton est conservé, jamais le code
  // d'accès ni le PIN. Il vit le temps de l'onglet (sessionStorage).
  session: sessionStorage.getItem("cadre_session") || null,
  moi: null, // { nom, admin }
  data: null, // { cadres, services, civilites, emailAuto }
  edition: null, // id du cadre ouvert dans la fiche (null = création)
  recherche: "",
  voirInactifs: false,
};

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

function ouvrirSession(jeton) {
  state.session = jeton || null;
  if (jeton) sessionStorage.setItem("cadre_session", jeton);
  else sessionStorage.removeItem("cadre_session");
}

async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(state.session ? { "X-Cadre-Session": state.session } : {}),
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
    const payload = await api("POST", "/api/cadre/login", {
      email: $("login-email").value.trim(),
      code: $("login-code").value.trim(),
      pin: $("login-pin").value.trim(),
    });
    // Le compte existe et le PIN est bon, mais sans la case Administrateur il
    // n'a rien à faire ici : on n'ouvre pas de session dans cet onglet.
    if (!payload.moi || !payload.moi.admin) {
      throw new Error("Ce compte n'a pas les droits d'administration. Utilisez l'espace cadre.");
    }
    ouvrirSession(payload.session);
    state.moi = payload.moi;
    await entrerApp();
  } catch (err) {
    ouvrirSession(null);
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

$("refresh-btn").addEventListener("click", async () => {
  const btn = $("refresh-btn");
  btn.disabled = true;
  try {
    await charger();
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
  }
});

/** Charge les données PUIS bascule sur l'application : si l'appel échoue
 *  (jeton expiré, droits retirés), on reste sur l'écran de connexion. */
async function entrerApp() {
  await charger();
  $("login-screen").hidden = true;
  $("app-screen").hidden = false;
}

async function charger() {
  state.data = await api("GET", "/api/admin/cadres");
  // Qui est connecté vient de la réponse : ainsi une session déjà ouverte dans
  // l'onglet retrouve son identité sans repasser par le formulaire.
  state.moi = state.data.moi || state.moi;
  $("admin-qui").textContent = state.moi ? state.moi.nom : "";
  rendre();
}

/* ------------------------------------------------------------------ */
/* Lecture du modèle                                                   */
/* ------------------------------------------------------------------ */

/** Services d'un cadre, avec la façon dont il y est rattaché. */
function servicesDuCadre(cadreId) {
  return (state.data.services || [])
    .map((s) => {
      if (s.Cadre_ref === cadreId) return { s, role: "referent" };
      if ((s.Pole_CSS || []).includes(cadreId)) return { s, role: "css" };
      if ((s.Cadres_secondaires || []).includes(cadreId)) return { s, role: "secondaire" };
      return null;
    })
    .filter(Boolean);
}

const ROLE_LABEL = { referent: "référent", css: "CSS de pôle", secondaire: "" };

/** Nom affiché d'un service (avec son site quand il est renseigné). */
function nomService(s) {
  return s.Site ? `${s.Nom} (${s.Site})` : s.Nom;
}

/** État du 2ᵉ facteur d'un compte, en clair. */
function etatPin(c) {
  if (c.PIN_bloque_secondes > 0) {
    const min = Math.ceil(c.PIN_bloque_secondes / 60);
    return { texte: `bloqué ${min} min`, badge: "warn" };
  }
  if (c.PIN_reinit_demande) return { texte: "réinitialisé — à choisir", badge: "pending" };
  if (!c.PIN_defini) return { texte: "à choisir à la 1ʳᵉ connexion", badge: "info" };
  return { texte: "défini", badge: "ok" };
}

function nomComplet(c) {
  return [c.Civilite, c.Nom, c.Prenom].filter(Boolean).join(" ");
}

/** Cadres à afficher, filtrés par la recherche et la case « désactivés ». */
function cadresAffiches() {
  const q = state.recherche.trim().toLowerCase();
  return (state.data.cadres || [])
    .filter((c) => (state.voirInactifs ? true : c.Actif))
    .filter((c) => {
      if (!q) return true;
      const services = servicesDuCadre(c.id).map(({ s }) => `${s.Nom} ${s.Site}`).join(" ");
      return [nomComplet(c), c.Email, c.Telephone, services].join(" ").toLowerCase().includes(q);
    })
    .sort((a, b) => (a.Nom || "").localeCompare(b.Nom || "", "fr"));
}

/* ------------------------------------------------------------------ */
/* Tableau des cadres                                                  */
/* ------------------------------------------------------------------ */

/** Petite étiquette colorée (badge). */
function badge(texte, type) {
  const el = document.createElement("span");
  el.className = "badge" + (type ? ` ${type}` : "");
  el.textContent = texte;
  return el;
}

function cellule(...enfants) {
  const td = document.createElement("td");
  for (const e of enfants) if (e) td.appendChild(typeof e === "string" ? document.createTextNode(e) : e);
  return td;
}

function bouton(texte, onClick, classe) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = classe || "btn btn-ghost btn-small";
  b.textContent = texte;
  b.addEventListener("click", onClick);
  return b;
}

function rendre() {
  const wrap = $("cadres-wrap");
  wrap.textContent = "";

  const liste = cadresAffiches();
  if (!liste.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = state.recherche
      ? "Aucun cadre ne correspond à cette recherche."
      : "Aucun compte cadre pour l'instant : créez le premier avec « + Nouveau cadre ».";
    wrap.appendChild(p);
    return;
  }

  const table = document.createElement("table");
  table.className = "admin";

  const thead = document.createElement("thead");
  const trh = document.createElement("tr");
  for (const titre of ["Cadre", "Contact", "Services", "Code PIN", ""]) {
    const th = document.createElement("th");
    th.textContent = titre;
    trh.appendChild(th);
  }
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const c of liste) {
    const tr = document.createElement("tr");
    if (!c.Actif) tr.className = "inactif";

    // Identité + étiquettes (administrateur, compte désactivé)
    const nom = document.createElement("div");
    nom.className = "cadre-nom";
    nom.textContent = nomComplet(c) || "(sans nom)";
    const badges = document.createElement("div");
    badges.className = "badges";
    if (c.Administrateur) badges.appendChild(badge("Administrateur", "info"));
    if (!c.Actif) badges.appendChild(badge("Désactivé", "warn"));
    tr.appendChild(cellule(nom, badges));

    // Contact
    const contact = document.createElement("div");
    contact.textContent = c.Email || "—";
    const tel = document.createElement("div");
    tel.className = "cadre-sous";
    tel.textContent = c.Telephone || "";
    tr.appendChild(cellule(contact, tel));

    // Services rattachés
    const svc = document.createElement("div");
    svc.className = "svc-list";
    const rattachements = servicesDuCadre(c.id);
    svc.textContent = rattachements.length
      ? rattachements
          .map(({ s, role }) => nomService(s) + (ROLE_LABEL[role] ? ` — ${ROLE_LABEL[role]}` : ""))
          .join(", ")
      : "aucun service";
    if (!rattachements.length) svc.style.color = "var(--alerte)";
    tr.appendChild(cellule(svc));

    // État du PIN
    const pin = etatPin(c);
    tr.appendChild(cellule(badge(pin.texte, pin.badge)));

    // Actions
    const actions = cellule(
      bouton("✉ Inviter", () => ouvrirInvitation(c)),
      bouton("Modifier", () => ouvrirFiche(c), "btn btn-secondary btn-small")
    );
    actions.className = "actions";
    tr.appendChild(actions);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
}

$("search").addEventListener("input", (e) => {
  state.recherche = e.target.value;
  rendre();
});

$("voir-inactifs").addEventListener("change", (e) => {
  state.voirInactifs = e.target.checked;
  rendre();
});

$("new-cadre-btn").addEventListener("click", () => ouvrirFiche(null));

/* ------------------------------------------------------------------ */
/* Fiche d'un cadre                                                    */
/* ------------------------------------------------------------------ */

const dlg = $("cadre-dialog");

/** Ouvre la fiche : `cadre` null = création. */
function ouvrirFiche(cadre) {
  state.edition = cadre ? cadre.id : null;
  $("cadre-error").hidden = true;
  $("cadre-dialog-title").textContent = cadre ? "Modifier un cadre" : "Nouveau cadre";
  $("cadre-save-btn").textContent = cadre ? "Enregistrer" : "Créer le compte";

  // Civilités proposées par le Worker (mêmes valeurs que la colonne Grist).
  const sel = $("f-civilite");
  sel.textContent = "";
  for (const c of ["", ...(state.data.civilites || [])]) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c || "—";
    sel.appendChild(opt);
  }
  sel.value = cadre ? cadre.Civilite || "" : "";

  $("f-nom").value = cadre ? cadre.Nom || "" : "";
  $("f-prenom").value = cadre ? cadre.Prenom || "" : "";
  $("f-telephone").value = cadre ? cadre.Telephone || "" : "";
  $("f-actif").checked = cadre ? cadre.Actif : true;
  $("f-admin").checked = cadre ? cadre.Administrateur : false;

  // Sur son propre compte, ces deux cases sont grisées : se désactiver ou se
  // retirer ses droits fermerait l'espace admin sans moyen de le rouvrir.
  // Le Worker refuse de toute façon, la fiche évite juste la fausse manœuvre.
  const soiMeme = !!cadre && !!state.moi && cadre.id === state.moi.id;
  $("f-actif").disabled = soiMeme;
  $("f-admin").disabled = soiMeme;
  $("f-soi-note").hidden = !soiMeme;

  // Adresse e-mail : saisissable seulement si le document ne la calcule pas.
  $("f-email-wrap").hidden = state.data.emailAuto;
  $("f-email-auto").hidden = !state.data.emailAuto;
  $("f-email").value = cadre ? cadre.Email || "" : "";

  rendreServices(cadre);
  rendreAcces(cadre);
  dlg.showModal();
  $("f-nom").focus();
}

/** Cases à cocher des services, avec les rattachements figés en lecture seule. */
function rendreServices(cadre) {
  const wrap = $("f-services");
  wrap.textContent = "";
  const services = [...(state.data.services || [])].sort((a, b) =>
    `${a.Site} ${a.Nom}`.localeCompare(`${b.Site} ${b.Nom}`, "fr"));

  if (!services.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "Aucun service dans le document.";
    wrap.appendChild(p);
    return;
  }

  for (const s of services) {
    const role = cadre
      ? (servicesDuCadre(cadre.id).find((r) => r.s.id === s.id) || {}).role
      : undefined;
    const fige = role === "referent" || role === "css";

    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = String(s.id);
    input.checked = !!role;
    input.disabled = fige;
    input.dataset.fige = fige ? "1" : "";

    const texte = document.createElement("span");
    texte.textContent = nomService(s)
      + (fige ? ` — ${ROLE_LABEL[role]}` : "")
      + (s.Recoit_des_etudiant ? "" : " — n'accueille pas d'étudiants");
    if (fige) texte.className = "fige";

    label.appendChild(input);
    label.appendChild(texte);
    wrap.appendChild(label);
  }
}

/** Bloc « Accès et sécurité » : visible seulement sur un compte existant. */
function rendreAcces(cadre) {
  $("f-acces").hidden = !cadre;
  if (!cadre) return;

  const codeEl = $("f-code");
  codeEl.textContent = "•".repeat(Math.max(8, (cadre.Code_acces || "").length));
  codeEl.dataset.visible = "";
  $("f-code-voir").textContent = "Afficher";

  const pin = etatPin(cadre);
  const etat = $("f-pin-etat");
  etat.textContent = "";
  etat.appendChild(badge(pin.texte, pin.badge));
  if (cadre.PIN_essais > 0 && cadre.PIN_bloque_secondes === 0) {
    const essais = document.createElement("span");
    essais.className = "cadre-sous";
    essais.textContent = ` ${cadre.PIN_essais} essai(s) manqué(s)`;
    etat.appendChild(essais);
  }
  $("f-pin-debloquer").hidden = cadre.PIN_bloque_secondes === 0;
}

/** Le cadre actuellement ouvert dans la fiche, relu depuis les données. */
function cadreEdite() {
  if (!state.edition) return null;
  return (state.data.cadres || []).find((c) => c.id === state.edition) || null;
}

$("cadre-cancel-btn").addEventListener("click", () => dlg.close());

$("cadre-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("cadre-save-btn");
  const errEl = $("cadre-error");
  errEl.hidden = true;
  btn.disabled = true;
  try {
    const services = [...$("f-services").querySelectorAll("input[type=checkbox]")]
      .filter((i) => i.checked && !i.dataset.fige)
      .map((i) => Number(i.value));

    const corps = {
      Civilite: $("f-civilite").value,
      Nom: $("f-nom").value.trim(),
      Prenom: $("f-prenom").value.trim(),
      Telephone: $("f-telephone").value.trim(),
      Actif: $("f-actif").checked,
      Administrateur: $("f-admin").checked,
      services,
    };
    if (!state.data.emailAuto) corps.Email = $("f-email").value.trim();

    if (state.edition) {
      await api("PATCH", `/api/admin/cadres/${state.edition}`, corps);
      dlg.close();
      await charger();
      toast("Compte mis à jour.");
    } else {
      const res = await api("POST", "/api/admin/cadres", corps);
      dlg.close();
      await charger();
      montrerCode(res.Code_acces, `Compte créé pour ${corps.Prenom} ${corps.Nom}.`);
    }
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

/* ------------------------------------------------------------------ */
/* Actions d'accès (immédiates, sur un compte existant)                */
/* ------------------------------------------------------------------ */

/** Envoie une action au Worker, recharge, et rouvre la fiche à jour. */
async function actionCompte(corps, message) {
  const id = state.edition;
  if (!id) return;
  const errEl = $("cadre-error");
  errEl.hidden = true;
  try {
    const res = await api("PATCH", `/api/admin/cadres/${id}`, corps);
    await charger();
    const maj = (state.data.cadres || []).find((c) => c.id === id);
    if (maj) rendreAcces(maj);
    if (res.Code_acces) montrerCode(res.Code_acces, "Nouveau code d'accès.");
    else toast(message);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
}

$("f-code-voir").addEventListener("click", () => {
  const cadre = cadreEdite();
  if (!cadre) return;
  const el = $("f-code");
  const visible = el.dataset.visible === "1";
  el.dataset.visible = visible ? "" : "1";
  el.textContent = visible ? "•".repeat(Math.max(8, cadre.Code_acces.length)) : cadre.Code_acces;
  $("f-code-voir").textContent = visible ? "Afficher" : "Masquer";
});

$("f-code-copier").addEventListener("click", () => {
  const cadre = cadreEdite();
  if (cadre) copier(cadre.Code_acces, "Code d'accès copié.");
});

$("f-code-regen").addEventListener("click", () => {
  const cadre = cadreEdite();
  if (!cadre) return;
  if (!confirm(`Régénérer le code d'accès de ${nomComplet(cadre)} ?\n\n`
    + "L'ancien code cessera immédiatement de fonctionner et ses sessions ouvertes "
    + "seront fermées. Il faudra lui transmettre le nouveau code.")) return;
  actionCompte({ regenererCode: true });
});

$("f-pin-reinit").addEventListener("click", () => {
  const cadre = cadreEdite();
  if (!cadre) return;
  if (!confirm(`Réinitialiser le code PIN de ${nomComplet(cadre)} ?\n\n`
    + "Il en choisira un nouveau à sa prochaine connexion. Ses sessions ouvertes "
    + "seront fermées.")) return;
  actionCompte({ reinitPin: true }, "PIN réinitialisé : le cadre en choisira un nouveau.");
});

$("f-pin-debloquer").addEventListener("click", () => {
  actionCompte({ debloquerPin: true }, "Compte débloqué.");
});

$("f-inviter").addEventListener("click", () => {
  const cadre = cadreEdite();
  if (cadre) ouvrirInvitation(cadre);
});

/* ------------------------------------------------------------------ */
/* Invitation par e-mail                                               */
/* ------------------------------------------------------------------ */

/** Lien de connexion pré-rempli. Les identifiants passent après le dièse : ce
 *  qui suit « # » n'est jamais envoyé au serveur, donc le code d'accès
 *  n'apparaît pas dans les journaux d'accès de l'hébergeur. */
function lienConnexion(cadre) {
  const base = location.href.replace(/[^/]*(\?.*)?(#.*)?$/, "");
  return base + "espace-cadre.html#email=" + encodeURIComponent(cadre.Email)
    + "&code=" + encodeURIComponent(cadre.Code_acces);
}

/** Prépare le mail d'invitation (même contenu que la formule Grist d'origine). */
function ouvrirInvitation(cadre) {
  if (!cadre.Email) {
    toast("Ce compte n'a pas d'adresse e-mail : renseignez-la d'abord.", true);
    return;
  }
  const objet = "Vos identifiants pour l'espace cadre 🔑";
  const corps = [
    "Bonjour 👋,",
    "",
    "Voici vos identifiants pour l'espace cadre en ligne (planning, validations, fiches étudiants) :",
    "",
    "• Email : " + cadre.Email,
    "• Code d'accès : " + cadre.Code_acces,
    "",
    "🔗 Votre lien de connexion :",
    lienConnexion(cadre),
    "",
    "🔑 PREMIÈRE CONNEXION : VOUS CHOISISSEZ VOTRE CODE PIN",
    "Le code PIN n'est pas dans ce mail : vous l'inventez à la 1re connexion.",
    "",
    "1. Ouvrez le lien ci-dessus : email et code d'accès sont déjà remplis.",
    "2. Champ « Code PIN » : tapez 4 à 6 chiffres de votre choix (pas 1234, pas une date de naissance).",
    "3. Cliquez sur « Se connecter » : ce code devient votre PIN.",
    "4. Notez-le et gardez-le pour vous : il sera redemandé à chaque connexion, avec l'email et le code d'accès.",
    "",
    "Ensuite : email + code d'accès + votre PIN, à chaque fois.",
    "PIN oublié ? Prévenez-moi : je le réinitialise, et vous en choisissez un nouveau à la connexion suivante.",
    "",
    "Dans l'espace cadre :",
    "✅ Déclarations à valider → heures déclarées par les étudiants",
    "👨‍🎓 Dossier étudiants → fiche et planning de chaque étudiant",
    "📅 Planning de service → 30 jours, modifiable case par case",
    "📝 Envoi des évaluations → questionnaire de fin de stage",
    "📖 Mode d'emploi complet : lien sur la page de connexion.",
    "",
    "N'hésitez pas à me contacter en cas de question ou de souci 😊",
    "",
    "À bientôt,",
    state.moi ? state.moi.nom : "",
  ].join("\n");

  location.href = "mailto:" + encodeURIComponent(cadre.Email)
    + "?subject=" + encodeURIComponent(objet)
    + "&body=" + encodeURIComponent(corps);
}

/* ------------------------------------------------------------------ */
/* Code d'accès : affichage unique après création / régénération       */
/* ------------------------------------------------------------------ */

const codeDlg = $("code-dialog");

function montrerCode(code, message) {
  $("code-dialog-hint").textContent = message || "";
  $("code-dialog-value").textContent = code;
  codeDlg.showModal();
}

$("code-copier-btn").addEventListener("click", () => {
  copier($("code-dialog-value").textContent, "Code copié.");
});

/* ------------------------------------------------------------------ */
/* Utilitaires d'interface                                             */
/* ------------------------------------------------------------------ */

function copier(texte, message) {
  const fini = () => toast(message || "Copié.");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(texte).then(fini, () => toast("Copie impossible.", true));
  } else {
    const ta = document.createElement("textarea");
    ta.value = texte;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      fini();
    } catch (e) {
      toast("Copie impossible.", true);
    }
    ta.remove();
  }
}

let toastTimer = null;
function toast(message, erreur) {
  if (!message) return;
  const ancien = document.querySelector(".toast");
  if (ancien) ancien.remove();
  const el = document.createElement("div");
  el.className = "toast" + (erreur ? " ko" : "");
  el.setAttribute("role", "status");
  el.textContent = message;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 4000);
}

/* ------------------------------------------------------------------ */
/* Démarrage : reprise d'une session déjà ouverte dans cet onglet      */
/* ------------------------------------------------------------------ */

if (state.session) {
  entrerApp()
    .catch(() => {
      // Jeton expiré, ou compte sans droits d'administration : on repart de
      // l'écran de connexion, sans message d'erreur inutile.
      sessionStorage.removeItem("cadre_session");
      state.session = null;
    });
}

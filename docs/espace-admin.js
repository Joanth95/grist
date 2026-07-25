/* Espace administrateur — comptes des cadres */
/* © Joan Thuillier — Tous droits réservés. Voir LICENSE à la racine du dépôt. */

/* Premier écran de l'espace d'administration : il reprend ce qui se faisait à
   la main dans le document Grist (créer un cadre, le rattacher à ses services,
   réinitialiser un PIN, débloquer un compte, régénérer un code d'accès).

   Connexion : la même que l'espace cadre (email + code d'accès + PIN, endpoint
   /api/cadre/login) et le même jeton de session — seuls les comptes dont la
   case UTILISATEURS.Administrateur est cochée passent la porte. Le contrôle
   qui compte est côté Worker : ici, on n'affiche que ce qui est autorisé. */

const APP_VERSION = "v5"; // à incrémenter à chaque mise à jour (cf. ?v= dans espace-admin.html)
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
  // Choix des services dans la fiche d'un cadre : ceux qu'on peut retirer, et
  // ceux qui sont figés (référent, CSS de pôle) et seulement affichés.
  ficheServices: new Set(),
  ficheFiges: new Map(),
  // Onglet « Services » : données propres, chargées à la première ouverture.
  onglet: "cadres",
  svc: null, // { schema, sites, poles, services, codes, cadres }
  editionService: null,
  editionPole: null,
  rechercheSvc: "",
  voirFermes: true,
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

/* --- Choix des services : site, puis service, puis récapitulatif ---------
   Le même nom de service existe souvent sur plusieurs sites (« EHPAD HEB »…) :
   passer par le site d'abord lève l'ambiguïté, et la liste reste courte même
   avec cinquante services. Les rattachements figés (référent, CSS de pôle)
   apparaissent dans le récapitulatif mais ne s'y retirent pas. */

/** Prépare l'état du choix des services pour le cadre ouvert dans la fiche. */
function rendreServices(cadre) {
  const roles = new Map(
    cadre ? servicesDuCadre(cadre.id).map(({ s, role }) => [s.id, role]) : []);

  state.ficheFiges = new Map(
    [...roles].filter(([, role]) => role === "referent" || role === "css"));
  state.ficheServices = new Set(
    [...roles].filter(([, role]) => role === "secondaire").map(([id]) => id));

  remplirSites();
  remplirServices();
  rendreRecap();
}

/** Sites proposés, dans l'ordre alphabétique. */
function remplirSites() {
  const sel = $("f-site");
  const sites = [...new Set((state.data.services || []).map((s) => s.Site || "Sans site"))]
    .sort((a, b) => (a === "Sans site" ? 1 : b === "Sans site" ? -1 : a.localeCompare(b, "fr")));

  const choisi = sel.value;
  sel.textContent = "";
  sel.appendChild(option("", sites.length ? "— Choisir un site —" : "Aucun site"));
  for (const site of sites) sel.appendChild(option(site, site));
  if (sites.includes(choisi)) sel.value = choisi;
}

/** Services du site choisi, moins ceux déjà retenus. */
function remplirServices() {
  const sel = $("f-service");
  const site = $("f-site").value;
  sel.textContent = "";

  if (!site) {
    sel.appendChild(option("", "— Choisir un site d'abord —"));
    sel.disabled = true;
    return;
  }
  const dispo = (state.data.services || [])
    .filter((s) => (s.Site || "Sans site") === site)
    .filter((s) => !state.ficheServices.has(s.id) && !state.ficheFiges.has(s.id))
    .sort((a, b) => (a.Nom || "").localeCompare(b.Nom || "", "fr"));

  sel.disabled = !dispo.length;
  sel.appendChild(option("", dispo.length
    ? "— Choisir un service —"
    : "Tous les services de ce site sont déjà rattachés"));
  for (const s of dispo) {
    sel.appendChild(option(String(s.id),
      s.Nom + (s.Recoit_des_etudiant ? "" : " — n'accueille pas d'étudiants")));
  }
}

function option(valeur, texte) {
  const o = document.createElement("option");
  o.value = valeur;
  o.textContent = texte;
  return o;
}

/** Récapitulatif des services retenus, groupé par site. */
function rendreRecap() {
  const ul = $("f-recap");
  ul.textContent = "";

  const retenus = (state.data.services || [])
    .filter((s) => state.ficheServices.has(s.id) || state.ficheFiges.has(s.id));
  $("f-recap-vide").hidden = retenus.length > 0;
  if (!retenus.length) return;

  const parSite = new Map();
  for (const s of retenus) {
    const site = s.Site || "Sans site";
    if (!parSite.has(site)) parSite.set(site, []);
    parSite.get(site).push(s);
  }
  const sites = [...parSite.keys()].sort((a, b) =>
    (a === "Sans site" ? 1 : b === "Sans site" ? -1 : a.localeCompare(b, "fr")));

  for (const site of sites) {
    const titre = document.createElement("li");
    titre.className = "site";
    titre.textContent = site;
    ul.appendChild(titre);

    for (const s of parSite.get(site).sort((a, b) => (a.Nom || "").localeCompare(b.Nom || "", "fr"))) {
      const li = document.createElement("li");
      li.className = "ligne";

      const nom = document.createElement("span");
      nom.className = "nom";
      nom.textContent = s.Nom + (s.Recoit_des_etudiant ? "" : " — n'accueille pas d'étudiants");
      li.appendChild(nom);

      const role = state.ficheFiges.get(s.id);
      if (role) {
        // Référent ou CSS de pôle : rattachement porté par une autre colonne,
        // qui se change dans l'onglet Services.
        const r = document.createElement("span");
        r.className = "role";
        r.textContent = ROLE_LABEL[role];
        li.appendChild(r);
      } else {
        const x = document.createElement("button");
        x.type = "button";
        x.className = "retirer";
        x.textContent = "×";
        x.title = `Retirer ${s.Nom}`;
        x.setAttribute("aria-label", `Retirer ${s.Nom}`);
        x.addEventListener("click", () => {
          state.ficheServices.delete(s.id);
          remplirServices();
          rendreRecap();
        });
        li.appendChild(x);
      }
      ul.appendChild(li);
    }
  }
}

$("f-site").addEventListener("change", remplirServices);

$("f-service").addEventListener("change", (e) => {
  const id = Number(e.target.value);
  if (!id) return;
  state.ficheServices.add(id);
  remplirServices(); // le service choisi sort de la liste
  rendreRecap();
});

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
    // Seuls les rattachements modifiables partent : les figés (référent, CSS)
    // sont portés par d'autres colonnes, que le Worker laisse tranquilles.
    const services = [...state.ficheServices];

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
/* Onglets                                                             */
/* ------------------------------------------------------------------ */

document.querySelectorAll(".admin-tab").forEach((btn) => {
  btn.addEventListener("click", () => montrerOnglet(btn.dataset.onglet));
});

const ONGLETS = ["cadres", "services", "poles", "organigramme"];

async function montrerOnglet(id) {
  state.onglet = id;
  document.querySelectorAll(".admin-tab").forEach((b) =>
    b.classList.toggle("active", b.dataset.onglet === id));
  for (const o of ONGLETS) $(`tab-${o}`).hidden = o !== id;

  // Services, pôles et organigramme partagent les mêmes données : un seul
  // chargement, à la première ouverture de l'un des trois.
  if (id !== "cadres") {
    try {
      if (!state.svc) await chargerServices();
      else if (id === "poles") rendrePoles();
      else if (id === "organigramme") rendreOrganigramme();
    } catch (err) {
      toast(err.message, true);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Écran des services                                                  */
/* ------------------------------------------------------------------ */

async function chargerServices() {
  state.svc = await api("GET", "/api/admin/organisation");
  rendreServicesEcran();
  rendrePoles();
  rendreOrganigramme();
}

/** Un cadre depuis son identifiant, actif ou non. */
function cadreParId(id) {
  return (state.svc.cadres || []).find((x) => x.id === id) || null;
}

/** Nom d'un cadre depuis son identifiant. Un compte désactivé garde son nom —
 *  il reste référent tant qu'on ne l'a pas remplacé — avec la mention qui va
 *  bien. Un identifiant qui ne correspond à rien signale une ligne supprimée
 *  dans Grist alors que des services y renvoyaient encore. */
function nomCadreId(id, avecMention) {
  const c = cadreParId(id);
  if (!c) return `cadre supprimé (#${id})`;
  return c.nom + (avecMention !== false && !c.actif ? " (compte désactivé)" : "");
}

/** Cadres à proposer dans une liste : les comptes actifs, plus celui qui est
 *  déjà en place même s'il est désactivé — sans quoi enregistrer la fiche
 *  effacerait le rattachement sans prévenir. */
function cadresProposables(dejaChoisis) {
  const gardes = new Set(dejaChoisis || []);
  return (state.svc.cadres || []).filter((c) => c.actif || gardes.has(c.id));
}

/** Libellé d'un cadre dans une liste de choix. */
function libelleCadre(c) {
  return c.nom + (c.actif ? "" : " — compte désactivé");
}

function servicesAffiches() {
  const q = state.rechercheSvc.trim().toLowerCase();
  return (state.svc.services || [])
    .filter((s) => (state.voirFermes ? true : s.Recoit_des_etudiant))
    .filter((s) => !q || [s.Nom, s.Code_UF, s.Site].join(" ").toLowerCase().includes(q));
}

function rendreServicesEcran() {
  const wrap = $("services-wrap");
  wrap.textContent = "";

  const liste = servicesAffiches();
  if (!liste.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = state.rechercheSvc
      ? "Aucun service ne correspond à cette recherche."
      : "Aucun service pour l'instant : créez un site, puis un service.";
    wrap.appendChild(p);
    return;
  }

  const parSite = new Map();
  for (const s of liste) {
    const site = s.Site || "Sans site";
    if (!parSite.has(site)) parSite.set(site, []);
    parSite.get(site).push(s);
  }
  const sites = [...parSite.keys()].sort((a, b) =>
    (a === "Sans site" ? 1 : b === "Sans site" ? -1 : a.localeCompare(b, "fr")));

  for (const site of sites) {
    const titre = document.createElement("h3");
    titre.className = "svc-groupe-titre";
    titre.textContent = site;
    wrap.appendChild(titre);

    const table = document.createElement("table");
    table.className = "admin";
    const thead = document.createElement("thead");
    const trh = document.createElement("tr");
    for (const t of ["Service", "Code UF", "Pôle", "Cadre référent", "Cadres rattachés", "Codes horaires", "Étudiants", ""]) {
      const th = document.createElement("th");
      th.textContent = t;
      trh.appendChild(th);
    }
    thead.appendChild(trh);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const s of parSite.get(site).sort((a, b) => (a.Nom || "").localeCompare(b.Nom || "", "fr"))) {
      const tr = document.createElement("tr");
      if (!s.Recoit_des_etudiant) tr.className = "inactif";

      const nom = document.createElement("span");
      nom.className = "cadre-nom";
      nom.textContent = s.Nom || "(sans nom)";
      tr.appendChild(cellule(nom));
      tr.appendChild(cellule(s.Code_UF || "—"));
      tr.appendChild(cellule(s.Pole || "—"));
      tr.appendChild(cellule(s.Cadre_ref ? nomCadreId(s.Cadre_ref) : "—"));

      // Rattachements secondaires + CSS de pôle : ce qui ouvre l'accès au service.
      const rattaches = s.Cadres_secondaires.length + s.Pole_CSS.length;
      tr.appendChild(cellule(rattaches
        ? `${rattaches} en plus du référent`
        : (s.Cadre_ref ? "le référent seul" : "personne")));

      // Liste vide = tous les codes du document.
      tr.appendChild(cellule(s.Codes.length ? `${s.Codes.length} choisis` : "tous"));

      tr.appendChild(cellule(s.Recoit_des_etudiant
        ? badge("Accueille", "ok")
        : badge("Fermé", "warn")));

      const actions = cellule(bouton("Modifier", () => ouvrirFicheService(s), "btn btn-secondary btn-small"));
      actions.className = "actions";
      tr.appendChild(actions);

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
  }
}

$("search-svc").addEventListener("input", (e) => {
  state.rechercheSvc = e.target.value;
  rendreServicesEcran();
});

$("voir-fermes").addEventListener("change", (e) => {
  state.voirFermes = e.target.checked;
  rendreServicesEcran();
});

$("new-service-btn").addEventListener("click", () => ouvrirFicheService(null));
$("new-site-btn").addEventListener("click", () => {
  $("site-error").hidden = true;
  $("site-nom").value = "";
  $("site-dialog").showModal();
  $("site-nom").focus();
});

/* --- Fiche d'un service --- */

function ouvrirFicheService(svc) {
  state.editionService = svc ? svc.id : null;
  $("service-error").hidden = true;
  $("service-dialog-title").textContent = svc ? "Modifier un service" : "Nouveau service";
  $("service-save-btn").textContent = svc ? "Enregistrer" : "Créer le service";
  $("s-nom").value = svc ? svc.Nom : "";
  $("s-uf").value = svc ? svc.Code_UF : "";
  $("s-ouvert").checked = svc ? svc.Recoit_des_etudiant : true;

  const selSite = $("s-site");
  selSite.textContent = "";
  selSite.appendChild(option("", "— Aucun site —"));
  for (const site of state.svc.sites || []) selSite.appendChild(option(String(site.id), site.NOM));
  selSite.value = svc && svc.SiteId ? String(svc.SiteId) : "";

  const selRef = $("s-ref");
  selRef.textContent = "";
  selRef.appendChild(option("", "— Aucun référent —"));
  // Le référent en place reste dans la liste même désactivé : sans lui,
  // enregistrer la fiche le remplacerait par « aucun ».
  for (const c of cadresProposables(svc && svc.Cadre_ref ? [svc.Cadre_ref] : [])) {
    selRef.appendChild(option(String(c.id), libelleCadre(c)));
  }
  selRef.value = svc && svc.Cadre_ref ? String(svc.Cadre_ref) : "";

  // Pôle : proposé seulement si le document sait relier un service à un pôle.
  const schema = state.svc.schema || {};
  const polesUtilisables = schema.poleTable && schema.servicePole;
  $("s-pole-wrap").hidden = !polesUtilisables;
  $("s-pole-absent").hidden = polesUtilisables;
  $("s-pole-absent").textContent = schema.poleTable
    ? "Ce document n'a pas de colonne reliant un service à un pôle : le rattachement au pôle ne peut pas se régler ici."
    : "Ce document n'a pas de table « Pole » : les pôles et les cadres supérieurs ne s'appliquent pas.";
  if (polesUtilisables) {
    const selPole = $("s-pole");
    selPole.textContent = "";
    selPole.appendChild(option("", "— Aucun pôle —"));
    for (const p of state.svc.poles || []) selPole.appendChild(option(String(p.id), p.Nom));
    selPole.value = svc && svc.PoleId ? String(svc.PoleId) : "";
  }

  rendreCodesService(svc);

  $("service-dialog").showModal();
  $("s-nom").focus();
}

/** Codes horaires actifs du service : aucun coché = tous les codes du
 *  document (même convention que l'onglet « Codes horaires » de l'espace cadre). */
function rendreCodesService(svc) {
  const wrap = $("s-codes");
  wrap.textContent = "";
  const codes = state.svc.codes || [];
  const actifs = new Set(svc ? svc.Codes : []);

  if (!codes.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "Aucun code horaire dans le document.";
    wrap.appendChild(p);
  }
  for (const c of codes) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = String(c.id);
    input.checked = actifs.has(c.id);
    input.addEventListener("change", majNoteCodes);

    const texte = document.createElement("span");
    texte.textContent = c.Code + (c.Libelle ? ` — ${c.Libelle}` : "");
    const horaire = document.createElement("span");
    horaire.className = "horaire";
    if (c.Heure_debut && c.Heure_fin) horaire.textContent = ` ${c.Heure_debut}–${c.Heure_fin}`;

    label.appendChild(input);
    label.appendChild(texte);
    label.appendChild(horaire);
    wrap.appendChild(label);
  }
  majNoteCodes();
}

function majNoteCodes() {
  const n = [...$("s-codes").querySelectorAll("input:checked")].length;
  $("s-codes-note").textContent = n
    ? `${n} code(s) proposé(s) aux cadres de ce service dans le planning.`
    : "Aucun coché = tous les codes horaires du document sont proposés.";
}

$("service-cancel-btn").addEventListener("click", () => $("service-dialog").close());

$("service-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("service-save-btn");
  const errEl = $("service-error");
  errEl.hidden = true;
  btn.disabled = true;
  try {
    const corps = {
      Nom: $("s-nom").value.trim(),
      Code_UF: $("s-uf").value.trim(),
      SiteId: Number($("s-site").value) || 0,
      Cadre_ref: Number($("s-ref").value) || 0,
      Recoit_des_etudiant: $("s-ouvert").checked,
      Codes: [...$("s-codes").querySelectorAll("input:checked")].map((i) => Number(i.value)),
    };
    if (!$("s-pole-wrap").hidden) corps.PoleId = Number($("s-pole").value) || 0;
    if (state.editionService) {
      await api("PATCH", `/api/admin/services/${state.editionService}`, corps);
    } else {
      await api("POST", "/api/admin/services", corps);
    }
    $("service-dialog").close();
    await chargerServices();
    // L'écran des cadres affiche les mêmes services : il doit suivre.
    await charger();
    toast(state.editionService ? "Service mis à jour." : "Service créé.");
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

/* --- Nouveau site --- */

$("site-cancel-btn").addEventListener("click", () => $("site-dialog").close());

$("site-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("site-save-btn");
  const errEl = $("site-error");
  errEl.hidden = true;
  btn.disabled = true;
  try {
    const res = await api("POST", "/api/admin/sites", { NOM: $("site-nom").value.trim() });
    $("site-dialog").close();
    await chargerServices();
    toast(`Site « ${res.NOM} » créé : il est proposé à la création d'un service.`);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

/* ------------------------------------------------------------------ */
/* Écran des pôles                                                     */
/* ------------------------------------------------------------------ */

function rendrePoles() {
  const wrap = $("poles-wrap");
  wrap.textContent = "";
  const schema = state.svc.schema || {};
  $("new-pole-btn").disabled = !schema.poleTable || !schema.poleNom;

  if (!schema.poleTable) {
    wrap.appendChild(messageVide(
      "Ce document n'a pas de table « Pole » : les pôles et les cadres supérieurs ne s'y appliquent pas."));
    return;
  }
  if (!schema.poleCSS) {
    wrap.appendChild(messageVide(
      "La table « Pole » n'a pas de colonne pointant vers UTILISATEURS : le cadre supérieur ne peut pas être désigné ici."));
  }

  const poles = state.svc.poles || [];
  if (!poles.length) {
    wrap.appendChild(messageVide("Aucun pôle pour l'instant : créez le premier avec « + Nouveau pôle »."));
    return;
  }

  const table = document.createElement("table");
  table.className = "admin";
  const thead = document.createElement("thead");
  const trh = document.createElement("tr");
  for (const t of ["Pôle", "Cadre(s) supérieur(s)", "Services rattachés", ""]) {
    const th = document.createElement("th");
    th.textContent = t;
    trh.appendChild(th);
  }
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const p of poles) {
    const tr = document.createElement("tr");

    const nom = document.createElement("span");
    nom.className = "cadre-nom";
    nom.textContent = p.Nom;
    tr.appendChild(cellule(nom));

    tr.appendChild(cellule(p.CSS.length ? p.CSS.map((id) => nomCadreId(id)).join(", ") : "—"));

    const rattaches = (state.svc.services || []).filter((s) => s.PoleId === p.id);
    const svc = document.createElement("div");
    svc.className = "svc-list";
    svc.textContent = rattaches.length
      ? rattaches.map((s) => s.Nom).join(", ")
      : "aucun service";
    tr.appendChild(cellule(svc));

    const actions = cellule(bouton("Modifier", () => ouvrirFichePole(p), "btn btn-secondary btn-small"));
    actions.className = "actions";
    tr.appendChild(actions);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
}

function messageVide(texte) {
  const p = document.createElement("p");
  p.className = "empty";
  p.textContent = texte;
  return p;
}

$("new-pole-btn").addEventListener("click", () => ouvrirFichePole(null));
$("pole-cancel-btn").addEventListener("click", () => $("pole-dialog").close());

function ouvrirFichePole(pole) {
  const schema = state.svc.schema || {};
  state.editionPole = pole ? pole.id : null;
  $("pole-error").hidden = true;
  $("pole-dialog-title").textContent = pole ? "Modifier un pôle" : "Nouveau pôle";
  $("pole-save-btn").textContent = pole ? "Enregistrer" : "Créer le pôle";
  $("p-nom").value = pole ? pole.Nom : "";

  // Le document décide : un seul cadre supérieur (liste déroulante) ou
  // plusieurs (cases à cocher).
  const wrap = $("p-css-wrap");
  wrap.textContent = "";
  const choisis = new Set(pole ? pole.CSS : []);
  $("p-css-label").textContent = schema.poleCSSListe
    ? "Cadres supérieurs de santé" : "Cadre supérieur de santé";

  if (!schema.poleCSS) {
    wrap.appendChild(messageVide("Colonne absente dans la table « Pole » : non modifiable ici."));
  } else if (schema.poleCSSListe) {
    const liste = document.createElement("div");
    liste.className = "css-picker";
    for (const c of cadresProposables([...choisis])) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = String(c.id);
      input.checked = choisis.has(c.id);
      const texte = document.createElement("span");
      texte.textContent = libelleCadre(c);
      label.appendChild(input);
      label.appendChild(texte);
      liste.appendChild(label);
    }
    wrap.appendChild(liste);
  } else {
    const sel = document.createElement("select");
    sel.id = "p-css-select";
    sel.appendChild(option("", "— Aucun —"));
    for (const c of cadresProposables([...choisis])) {
      sel.appendChild(option(String(c.id), libelleCadre(c)));
    }
    sel.value = choisis.size ? String([...choisis][0]) : "";
    wrap.appendChild(sel);
  }

  $("pole-dialog").showModal();
  $("p-nom").focus();
}

$("pole-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("pole-save-btn");
  const errEl = $("pole-error");
  errEl.hidden = true;
  btn.disabled = true;
  try {
    const schema = state.svc.schema || {};
    const corps = { Nom: $("p-nom").value.trim() };
    if (schema.poleCSS) {
      corps.CSS = schema.poleCSSListe
        ? [...$("p-css-wrap").querySelectorAll("input:checked")].map((i) => Number(i.value))
        : (Number(($("p-css-select") || {}).value) ? [Number($("p-css-select").value)] : []);
    }
    if (state.editionPole) {
      await api("PATCH", `/api/admin/poles/${state.editionPole}`, corps);
    } else {
      await api("POST", "/api/admin/poles", corps);
    }
    $("pole-dialog").close();
    await chargerServices();
    // Le CSS d'un pôle ouvre l'accès à ses services : l'écran des cadres suit.
    await charger();
    toast(state.editionPole ? "Pôle mis à jour." : "Pôle créé.");
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

/* ------------------------------------------------------------------ */
/* Organigramme : qui fait quoi, et où                                 */
/* ------------------------------------------------------------------ */

function rendreOrganigramme() {
  const services = state.svc.services || [];
  const cadres = state.svc.cadres || [];

  // Bandeau de chiffres
  const chiffres = $("orga-chiffres");
  chiffres.textContent = "";
  const ouverts = services.filter((s) => s.Recoit_des_etudiant).length;
  const compteurs = [
    [(state.svc.sites || []).length, "site(s)"],
    [(state.svc.poles || []).length, "pôle(s)"],
    [services.length, `service(s) — ${ouverts} ouvert(s)`],
    [cadres.filter((c) => c.actif).length, "cadre(s) actif(s)"],
  ];
  for (const [n, libelle] of compteurs) {
    const span = document.createElement("span");
    const b = document.createElement("b");
    b.textContent = String(n);
    span.appendChild(b);
    span.appendChild(document.createTextNode(" " + libelle));
    chiffres.appendChild(span);
  }

  const wrap = $("orga-wrap");
  wrap.textContent = "";
  if (!services.length) {
    wrap.appendChild(messageVide("Aucun service : commencez par l'onglet Services."));
    return;
  }

  // --- Par lieu : site > pôle > service ---
  const parSite = new Map();
  for (const s of services) {
    const site = s.Site || "Sans site";
    if (!parSite.has(site)) parSite.set(site, []);
    parSite.get(site).push(s);
  }
  const sites = [...parSite.keys()].sort((a, b) =>
    (a === "Sans site" ? 1 : b === "Sans site" ? -1 : a.localeCompare(b, "fr")));

  for (const site of sites) {
    const h = document.createElement("h3");
    h.className = "orga-site";
    h.textContent = site;
    wrap.appendChild(h);

    const parPole = new Map();
    for (const s of parSite.get(site)) {
      const pole = s.Pole || "";
      if (!parPole.has(pole)) parPole.set(pole, []);
      parPole.get(pole).push(s);
    }
    const poles = [...parPole.keys()].sort((a, b) =>
      (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, "fr")));

    for (const pole of poles) {
      const titre = document.createElement("div");
      titre.className = "orga-pole";
      titre.textContent = pole || "Hors pôle";
      const infoPole = (state.svc.poles || []).find((p) => p.Nom === pole);
      if (infoPole && infoPole.CSS.length) {
        const css = document.createElement("span");
        css.className = "css";
        css.textContent = ` — cadre sup. : ${infoPole.CSS.map((id) => nomCadreId(id)).join(", ")}`;
        titre.appendChild(css);
      }
      wrap.appendChild(titre);

      for (const s of parPole.get(pole).sort((a, b) => a.Nom.localeCompare(b.Nom, "fr"))) {
        wrap.appendChild(carteService(s));
      }
    }
  }

  // --- Par personne ---
  const h = document.createElement("h3");
  h.className = "orga-site";
  h.textContent = "Par cadre";
  wrap.appendChild(h);

  // Les comptes désactivés n'apparaissent que s'ils tiennent encore un rôle :
  // c'est exactement l'anomalie à voir (un référent parti, jamais remplacé).
  const roleDe = (c) => ({
    refs: services.filter((s) => s.Cadre_ref === c.id),
    secondaires: services.filter((s) => s.Cadres_secondaires.includes(c.id)),
    polesCSS: (state.svc.poles || []).filter((p) => p.CSS.includes(c.id)),
  });
  const aUnRole = (r) => r.refs.length || r.secondaires.length || r.polesCSS.length;
  const listables = cadres.filter((c) => c.actif || aUnRole(roleDe(c)));

  if (!listables.length) {
    wrap.appendChild(messageVide("Aucun cadre actif."));
    return;
  }
  for (const c of listables) {
    const bloc = document.createElement("div");
    bloc.className = "orga-personne";

    const qui = document.createElement("div");
    qui.className = "qui";
    qui.textContent = c.nom;
    if (!c.actif) qui.appendChild(badge("Compte désactivé", "warn"));
    if (c.email) {
      const mail = document.createElement("span");
      mail.className = "ou";
      mail.textContent = ` · ${c.email}${c.telephone ? ` · ${c.telephone}` : ""}`;
      qui.appendChild(mail);
    }
    bloc.appendChild(qui);

    const roles = [];
    const { refs, secondaires, polesCSS } = roleDe(c);
    if (refs.length) roles.push(`référent de ${refs.map(nomServiceOrga).join(", ")}`);
    if (secondaires.length) roles.push(`rattaché à ${secondaires.map(nomServiceOrga).join(", ")}`);
    if (polesCSS.length) {
      roles.push(`cadre supérieur du pôle ${polesCSS.map((p) => p.Nom).join(", ")}`
        + ` (donc de ${services.filter((s) => polesCSS.some((p) => p.id === s.PoleId)).length} service(s))`);
    }

    const ou = document.createElement("div");
    ou.className = roles.length ? "ou" : "ou orga-vide";
    ou.textContent = roles.length ? roles.join(" · ") : "aucun service rattaché — ce compte ne peut pas ouvrir l'espace cadre";
    bloc.appendChild(ou);
    wrap.appendChild(bloc);
  }
}

function nomServiceOrga(s) {
  return s.Site ? `${s.Nom} (${s.Site})` : s.Nom;
}

/** Une carte de service dans l'organigramme : le service, et qui s'en occupe. */
function carteService(s) {
  const carte = document.createElement("div");
  carte.className = "orga-service" + (s.Recoit_des_etudiant ? "" : " ferme");

  const titre = document.createElement("div");
  titre.className = "titre";
  titre.appendChild(document.createTextNode(s.Nom));
  if (s.Code_UF) {
    const uf = document.createElement("span");
    uf.className = "uf";
    uf.textContent = s.Code_UF;
    titre.appendChild(uf);
  }
  titre.appendChild(s.Recoit_des_etudiant ? badge("Accueille", "ok") : badge("Fermé", "warn"));
  carte.appendChild(titre);

  const gens = document.createElement("div");
  gens.className = "gens";
  const morceaux = [];
  if (s.Cadre_ref) morceaux.push(["référent : ", nomCadreId(s.Cadre_ref)]);
  if (s.Cadres_secondaires.length) {
    morceaux.push(["aussi : ", s.Cadres_secondaires.map((id) => nomCadreId(id)).join(", ")]);
  }
  if (s.Pole_CSS.length) morceaux.push(["cadre sup. : ", s.Pole_CSS.map((id) => nomCadreId(id)).join(", ")]);

  if (!morceaux.length) {
    gens.className = "gens orga-vide";
    gens.textContent = "personne n'est rattaché à ce service";
  } else {
    morceaux.forEach(([role, noms], i) => {
      if (i) gens.appendChild(document.createTextNode(" · "));
      const r = document.createElement("span");
      r.className = "role";
      r.textContent = role;
      gens.appendChild(r);
      gens.appendChild(document.createTextNode(noms));
    });
  }
  carte.appendChild(gens);
  return carte;
}

$("print-orga-btn").addEventListener("click", () => window.print());

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

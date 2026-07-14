/* Espace cadre — gestion des étudiants du service : planning, validations, fiches */

const API = window.CONFIG.API_URL.replace(/\/$/, "");
const $ = (id) => document.getElementById(id);
const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

const state = {
  email: sessionStorage.getItem("cadre_email") || null,
  code: sessionStorage.getItem("cadre_code") || null,
  data: null, // { services, niveaux, periodes, semaines, codes, sorties }
  selectedServiceId: null,
};

let editingCell = null; // { semaineId, jour }

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(state.email ? { "X-Cadre-Email": state.email, "X-Cadre-Code": state.code } : {}),
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
    state.email = $("login-email").value.trim();
    state.code = $("login-code").value.trim();
    state.data = await api("POST", "/api/cadre/login", { email: state.email, code: state.code });
    sessionStorage.setItem("cadre_email", state.email);
    sessionStorage.setItem("cadre_code", state.code);
    enterApp();
  } catch (err) {
    state.email = null;
    state.code = null;
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

$("refresh-btn").addEventListener("click", () => refresh().catch((err) => alert(err.message)));

function enterApp() {
  $("login-screen").hidden = true;
  $("app-screen").hidden = false;
  render();
}

async function refresh() {
  state.data = await api("GET", "/api/cadre/data");
  render();
}

/* ------------------------------------------------------------------ */
/* Rendu                                                               */
/* ------------------------------------------------------------------ */

function render() {
  renderServiceSelect();
  renderPending();
  renderEtudiants();
}

function renderServiceSelect() {
  const sel = $("service-select");
  const services = state.data.services;
  if (!services.some((s) => s.id === state.selectedServiceId)) {
    state.selectedServiceId = services[0] ? services[0].id : null;
  }
  sel.innerHTML = services.map((s) => `<option value="${s.id}">${escapeHtml(s.Nom)}</option>`).join("");
  sel.value = state.selectedServiceId;
  sel.onchange = () => {
    state.selectedServiceId = Number(sel.value);
    renderPending();
    renderEtudiants();
  };
}

function periodesDuService() {
  return state.data.periodes.filter((p) => p.Service === state.selectedServiceId);
}

function renderPending() {
  const container = $("pending");
  container.innerHTML = "";
  const periodeIds = new Set(periodesDuService().map((p) => p.id));
  const periodesById = new Map(state.data.periodes.map((p) => [p.id, p]));
  const pending = state.data.sorties
    .filter((s) => !s.Valide && periodeIds.has(s.Periode))
    .sort((a, b) => (a.Date || "").localeCompare(b.Date || ""));

  if (!pending.length) {
    container.appendChild(el("p", "empty", "Aucune déclaration en attente pour ce service."));
    return;
  }

  for (const s of pending) {
    const p = periodesById.get(s.Periode);
    const row = el("div", "pending-row");
    const main = el("div", "pending-main");
    const nomEtu = p ? `${p.Etudiant.prenom} ${p.Etudiant.nom}`.trim() : "";
    const titleText = s.Commentaire ? `${s.Motif} — ${s.Commentaire}` : s.Motif;
    main.appendChild(el("div", "sortie-title", `${nomEtu} · ${titleText}`));
    main.appendChild(el("div", "sortie-meta",
      `${frDate(s.Date)} · ${s.Heure_debut || "?"} – ${s.Heure_fin || "?"} · ${formatH(s.Duree_heures)}`));
    row.appendChild(main);

    const btn = el("button", "btn btn-primary", "Valider");
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await api("PATCH", `/api/cadre/sorties/${s.id}`, { Valide: true });
        await refresh();
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    });
    row.appendChild(btn);
    container.appendChild(row);
  }
}

function renderEtudiants() {
  const container = $("etudiants");
  container.innerHTML = "";
  const periodes = periodesDuService().sort((a, b) =>
    `${a.Etudiant.nom}${a.Etudiant.prenom}`.localeCompare(`${b.Etudiant.nom}${b.Etudiant.prenom}`));

  if (!periodes.length) {
    container.appendChild(el("p", "empty", "Aucun étudiant sur ce service."));
    return;
  }

  const codeById = new Map(state.data.codes.map((c) => [c.id, c]));

  for (const p of periodes) {
    const card = el("div", "etu-card");

    const header = el("div", "etu-header");
    header.appendChild(el("div", "etu-nom", `${p.Etudiant.prenom} ${p.Etudiant.nom}`.trim()));
    const stats = el("div", "etu-meta",
      `${formatH(p.FAIT)} effectuées / ${formatH(p.A_FAIRE)} à réaliser · Solde ${p.Solde_heures > 0 ? "+" : ""}${formatH(p.Solde_heures)}`);
    header.appendChild(stats);
    card.appendChild(header);

    card.appendChild(renderFiche(p));

    const weeks = state.data.semaines
      .filter((s) => s.Periode === p.id)
      .sort((a, b) => (a.Semaine_debut || "").localeCompare(b.Semaine_debut || ""));
    for (const week of weeks) {
      card.appendChild(renderWeek(week, codeById));
    }
    if (!weeks.length) {
      card.appendChild(el("p", "empty", "Planning non encore établi."));
    }

    container.appendChild(card);
  }
}

function renderFiche(p) {
  const wrap = el("div", "etu-fiche");

  const tuteurLabel = el("label", "", "Tuteur");
  const tuteurInput = document.createElement("input");
  tuteurInput.type = "text";
  tuteurInput.value = p.Tuteur || "";
  tuteurLabel.appendChild(tuteurInput);

  const niveauLabel = el("label", "", "Niveau");
  const niveauSelect = document.createElement("select");
  niveauSelect.innerHTML = state.data.niveaux.map((n) =>
    `<option value="${n}" ${n === p.Niveau ? "selected" : ""}>${n}</option>`).join("");
  niveauLabel.appendChild(niveauSelect);

  const duLabel = el("label", "", "Du");
  const duInput = document.createElement("input");
  duInput.type = "date";
  duInput.value = p.Du || "";
  duLabel.appendChild(duInput);

  const auLabel = el("label", "", "Au");
  const auInput = document.createElement("input");
  auInput.type = "date";
  auInput.value = p.Au || "";
  auLabel.appendChild(auInput);

  const saveBtn = el("button", "btn btn-ghost", "Enregistrer la fiche");
  saveBtn.type = "button";

  wrap.append(tuteurLabel, niveauLabel, duLabel, auLabel, saveBtn);

  const hint = el("p", "save-hint", "");

  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    hint.textContent = "";
    try {
      await api("PATCH", `/api/cadre/periodes/${p.id}`, {
        Tuteur: tuteurInput.value,
        Niveau: niveauSelect.value,
        Du: duInput.value,
        Au: auInput.value,
      });
      hint.textContent = "Enregistré.";
      await refresh();
    } catch (err) {
      hint.textContent = err.message;
    } finally {
      saveBtn.disabled = false;
    }
  });

  const container = el("div", "");
  container.append(wrap, hint);
  return container;
}

function renderWeek(week, codeById) {
  const card = el("section", "week-card");
  const header = el("div", "week-header");
  header.appendChild(el("h3", "", `Semaine du ${frDate(week.Semaine_debut)}`));
  card.appendChild(header);

  const grid = el("div", "week-grid");
  DAYS.forEach((day, i) => {
    const dayIso = addDaysIso(week.Semaine_debut, i);
    const code = codeById.get(week[day]);
    const info = (week.jours && week.jours[i]) || { heures: 0, ferie: false };
    const cell = el("div", "day-cell editable" + (info.ferie ? " ferie" : ""));

    const label = el("div", "day-label", `${day.slice(0, 3)}. ${dayNum(dayIso)}`);
    if (info.ferie) label.appendChild(el("span", "ferie-tag", "férié"));
    cell.appendChild(label);

    const chip = el("div", "day-chip", code ? code.Code : "—");
    if (code) chip.title = code.Libelle;
    cell.appendChild(chip);

    if (info.heures > 0) cell.appendChild(el("div", "day-hours", formatH(info.heures)));

    cell.addEventListener("click", () => openCodeDialog(week.id, day, week[day]));
    grid.appendChild(cell);
  });
  card.appendChild(grid);
  return card;
}

/* ------------------------------------------------------------------ */
/* Dialogue de sélection de code horaire                               */
/* ------------------------------------------------------------------ */

const codeDialog = $("code-dialog");

function openCodeDialog(semaineId, jour, currentCodeId) {
  editingCell = { semaineId, jour };
  const sel = $("code-select");
  const options = ['<option value="">— (aucun)</option>']
    .concat(state.data.codes.map((c) =>
      `<option value="${c.id}">${escapeHtml(c.Code)} — ${escapeHtml(c.Libelle)}</option>`));
  sel.innerHTML = options.join("");
  sel.value = currentCodeId || "";
  $("code-error").hidden = true;
  codeDialog.showModal();
}

$("code-cancel-btn").addEventListener("click", () => codeDialog.close());

$("code-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = $("code-error");
  errEl.hidden = true;
  const btn = $("code-save-btn");
  btn.disabled = true;
  try {
    const value = $("code-select").value;
    await api("PATCH", `/api/cadre/planning/${editingCell.semaineId}`, {
      jour: editingCell.jour,
      codeId: value ? Number(value) : null,
    });
    codeDialog.close();
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

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
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

if (state.email && state.code) {
  api("GET", "/api/cadre/data")
    .then((data) => { state.data = data; enterApp(); })
    .catch(() => { sessionStorage.clear(); state.email = null; state.code = null; });
}

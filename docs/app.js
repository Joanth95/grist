/* Espace étudiant — planning de stage hebdomadaire */

const API = window.CONFIG.API_URL.replace(/\/$/, "");
const $ = (id) => document.getElementById(id);
const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

const state = {
  code: sessionStorage.getItem("code") || null,
  data: null, // { etudiant, periodes, semaines, codes }
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
    state.data = await api("POST", "/api/login", { code: state.code });
    sessionStorage.setItem("code", state.code);
    enterApp();
  } catch (err) {
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

function enterApp() {
  $("login-screen").hidden = true;
  $("app-screen").hidden = false;
  const e = state.data.etudiant;
  $("student-name").textContent = `${e.prenom} ${e.nom}`.trim();
  render();
}

async function refresh() {
  state.data = await api("GET", "/api/data");
  render();
}

/* ------------------------------------------------------------------ */
/* Rendu                                                               */
/* ------------------------------------------------------------------ */

function currentPeriode() {
  const p = state.data.periodes;
  return p.find((x) => x.En_cours) || p[p.length - 1] || null;
}

function render() {
  renderPeriode();
  renderWeeks();
}

function renderPeriode() {
  const container = $("periode-info");
  container.innerHTML = "";
  const p = currentPeriode();
  if (!p) {
    container.appendChild(el("p", "empty", "Aucune période de stage enregistrée. Contactez votre encadrant."));
    $("add-week-btn").hidden = true;
    return;
  }

  const card = el("div", "periode-card");
  card.appendChild(el("div", "periode-service", p.Service || "Stage"));
  card.appendChild(el("div", "periode-dates",
    `Du ${frDate(p.Du)} au ${frDate(p.Au)}` +
    (p.Niveau ? ` · ${p.Niveau}` : "") +
    (p.Tuteur ? ` · Tuteur : ${p.Tuteur}` : "")));

  if (p.A_FAIRE != null) {
    const fait = p.FAIT ?? 0;
    const stats = el("div", "periode-stats");
    stats.appendChild(badge(`${fait} h effectuées`, "ok"));
    stats.appendChild(badge(`${p.A_FAIRE} h à réaliser`, ""));
    if (p.Solde_heures != null) {
      stats.appendChild(badge(`Solde : ${p.Solde_heures > 0 ? "+" : ""}${p.Solde_heures} h`,
        p.Solde_heures >= 0 ? "ok" : "warn"));
    }
    card.appendChild(stats);
  }
  container.appendChild(card);
  $("add-week-btn").hidden = false;
}

function renderWeeks() {
  const container = $("weeks");
  container.innerHTML = "";
  const p = currentPeriode();
  if (!p) return;

  const weeks = state.data.semaines
    .filter((s) => s.Periode === p.id)
    .sort((a, b) => (a.Semaine_debut || "").localeCompare(b.Semaine_debut || ""));

  if (!weeks.length) {
    container.appendChild(el("p", "empty", "Aucune semaine de planning pour l'instant. Ajoutez-en une !"));
    return;
  }

  const todayIso = isoDate(new Date());
  for (const week of weeks) container.appendChild(renderWeek(week, todayIso));
}

function renderWeek(week, todayIso) {
  const card = el("section", "week-card");

  const header = el("div", "week-header");
  header.appendChild(el("h2", "", `Semaine du ${frDate(week.Semaine_debut)}`));
  if (week.Total_h_semaine != null) {
    header.appendChild(el("span", "week-total", `${week.Total_h_semaine} h`));
  }
  card.appendChild(header);

  const grid = el("div", "week-grid");
  DAYS.forEach((day, i) => {
    const dayIso = addDaysIso(week.Semaine_debut, i);
    const cell = el("div", "day-cell" + (dayIso === todayIso ? " today" : ""));
    const lbl = el("label", "day-label", `${day.slice(0, 3)}. ${dayNum(dayIso)}`);
    const select = document.createElement("select");
    select.dataset.day = day;
    select.appendChild(new Option("—", "0"));
    for (const c of state.data.codes) {
      const hours = c.Heure_debut && c.Heure_fin ? ` (${c.Heure_debut}–${c.Heure_fin})` : "";
      const opt = new Option(`${c.Code} · ${c.Libelle}${hours}`, String(c.id));
      if (week[day] === c.id) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener("change", () => card.classList.add("dirty"));
    lbl.appendChild(select);
    cell.appendChild(lbl);
    grid.appendChild(cell);
  });
  card.appendChild(grid);

  const footer = el("div", "week-footer");
  const comment = document.createElement("input");
  comment.type = "text";
  comment.placeholder = "Commentaire (facultatif)";
  comment.maxLength = 500;
  comment.value = week.Commentaire || "";
  comment.addEventListener("input", () => card.classList.add("dirty"));
  const saveBtn = el("button", "btn btn-primary", "Enregistrer");
  saveBtn.addEventListener("click", () => saveWeek(week, card, comment, saveBtn));
  const status = el("span", "save-status", "");
  footer.append(comment, saveBtn, status);
  card.appendChild(footer);

  return card;
}

async function saveWeek(week, card, commentInput, saveBtn) {
  const status = card.querySelector(".save-status");
  const fields = { Commentaire: commentInput.value.trim() };
  for (const select of card.querySelectorAll("select")) {
    fields[select.dataset.day] = Number(select.value);
  }
  saveBtn.disabled = true;
  status.textContent = "Enregistrement…";
  status.className = "save-status";
  try {
    await api("PATCH", `/api/semaines/${week.id}`, fields);
    await refresh();
  } catch (err) {
    status.textContent = err.message;
    status.className = "save-status error";
    saveBtn.disabled = false;
  }
}

/* ------------------------------------------------------------------ */
/* Ajout de semaine                                                    */
/* ------------------------------------------------------------------ */

$("add-week-btn").addEventListener("click", async () => {
  const p = currentPeriode();
  if (!p) return;

  const weeks = state.data.semaines.filter((s) => s.Periode === p.id);
  let nextMonday;
  if (weeks.length) {
    const last = weeks.map((w) => w.Semaine_debut).sort().pop();
    nextMonday = addDaysIso(last, 7);
  } else {
    nextMonday = mondayIso(p.Du || isoDate(new Date()));
  }

  const btn = $("add-week-btn");
  btn.disabled = true;
  try {
    await api("POST", "/api/semaines", { Periode: p.id, Semaine_debut: nextMonday });
    await refresh();
  } catch (err) {
    alert(err.message);
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

function mondayIso(iso) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
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

/* ------------------------------------------------------------------ */
/* Démarrage                                                           */
/* ------------------------------------------------------------------ */

if (state.code) {
  api("GET", "/api/data")
    .then((data) => { state.data = data; enterApp(); })
    .catch(() => { sessionStorage.clear(); state.code = null; });
}

/* Espace cadre v28 - Navigation planning mois par mois */

const APP_VERSION = "v28";
const API = (window.CONFIG && window.CONFIG.API_URL) || "";
const $ = id => document.getElementById(id);
const DAYS = ["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];

const state = {
  email: sessionStorage.getItem("cadre_email") || null,
  code: sessionStorage.getItem("cadre_code") || null,
  data: null,
  selectedSite: null,
  selectedServiceId: null,
  activeTab: "dashboard",
  planningStart: null,
  planningPaintCode: undefined
};

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function isoDate(d) { return d.toISOString().slice(0,10); }
function firstDayOfMonthIso() {
  const d = new Date();
  return isoDate(new Date(d.getFullYear(), d.getMonth(), 1));
}
function addDaysIso(iso, n) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return isoDate(d);
}
function frDateCourt(iso) {
  if (!iso) return "?";
  return new Date(iso + "T00:00:00").toLocaleDateString("fr-FR", {day:"2-digit", month:"2-digit"});
}
function formatH(h) {
  if (h == null) return "0h";
  const neg = h < 0;
  const m = Math.round(Math.abs(h)*60);
  return (neg?"-":"") + Math.floor(m/60) + "h" + (m%60 ? String(m%60).padStart(2,"0") : "");
}
function isWeekendIso(iso) {
  const d = new Date(iso + "T00:00:00").getDay();
  return d === 0 || d === 6;
}

async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(state.email ? {"X-Cadre-Email": state.email, "X-Cadre-Code": state.code} : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Erreur " + res.status);
  return data;
}

/* === PLANNING MOIS PAR MOIS === */

function getMonthRange(isoStart) {
  const d = new Date(isoStart + "T00:00:00");
  return {
    firstDay: isoDate(new Date(d.getFullYear(), d.getMonth(), 1)),
    lastDay: isoDate(new Date(d.getFullYear(), d.getMonth()+1, 0)),
    year: d.getFullYear(),
    month: d.getMonth()
  };
}

function shiftMonth(delta) {
  const cur = new Date((state.planningStart || firstDayOfMonthIso()) + "T00:00:00");
  cur.setMonth(cur.getMonth() + delta);
  state.planningStart = isoDate(new Date(cur.getFullYear(), cur.getMonth(), 1));
  renderPlanningTab();
}

function renderPlanningTab() {
  const container = $("planning-service");
  if (!container) return;
  container.innerHTML = "";

  if (!state.planningStart) state.planningStart = firstDayOfMonthIso();
  const range = getMonthRange(state.planningStart);
  const daysInMonth = new Date(range.year, range.month + 1, 0).getDate();

  // Navigation
  const controls = el("div", "planning-controls");
  const nav = document.createElement("div");
  nav.style.cssText = "display:flex;align-items:center;gap:6px;background:#f5f5f5;border:1px solid #ddd;border-radius:6px;padding:2px 6px;";

  const btnPrev = el("button", "btn", "◄");
  btnPrev.onclick = () => shiftMonth(-1);
  const monthLabel = el("span", "");
  monthLabel.style.cssText = "font-weight:700;min-width:160px;text-align:center;padding:0 12px;";
  const monthName = new Date(range.year, range.month).toLocaleDateString("fr-FR", {month:"long", year:"numeric"});
  monthLabel.textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1);
  const btnNext = el("button", "btn", "►");
  btnNext.onclick = () => shiftMonth(1);

  nav.append(btnPrev, monthLabel, btnNext);

  const btnToday = el("button", "btn btn-primary", "Aujourd’hui");
  btnToday.onclick = () => { state.planningStart = firstDayOfMonthIso(); renderPlanningTab(); };
  const btnPrint = el("button", "btn", "🖨️ Imprimer");
  btnPrint.onclick = () => window.print();

  controls.append(nav, btnToday, btnPrint);
  container.appendChild(controls);

  // Palette (simplifiée)
  const palette = el("div", "code-palette");
  palette.innerHTML = "<strong>Palette :</strong> ";
  const codes = (state.data && state.data.codes) || [];
  codes.slice(0, 8).forEach(c => {
    const b = el("button", "btn", c.Code);
    b.onclick = () => state.planningPaintCode = c.id;
    palette.appendChild(b);
  });
  container.appendChild(palette);

  // Tableau
  const table = document.createElement("table");
  table.className = "service-planning";
  const thead = document.createElement("thead");
  const tr = document.createElement("tr");
  const th0 = document.createElement("th");
  th0.textContent = "Étudiant";
  tr.appendChild(th0);
  for (let i = 0; i < daysInMonth; i++) {
    const dayIso = addDaysIso(range.firstDay, i);
    const th = document.createElement("th");
    th.style.minWidth = "38px";
    th.style.fontSize = "0.75rem";
    const d = new Date(dayIso + "T00:00:00");
    th.innerHTML = d.getDate() + "<br><span style='font-size:0.65rem;opacity:0.6'>" + DAYS[d.getDay()===0?6:d.getDay()-1].slice(0,2) + "</span>";
    if (isWeekendIso(dayIso)) th.style.background = "#eee";
    tr.appendChild(th);
  }
  const thComp = document.createElement("th");
  thComp.textContent = "Compteurs";
  tr.appendChild(thComp);
  thead.appendChild(tr);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  const periodes = (state.data && state.data.periodes || []).filter(p => p.Service === state.selectedServiceId);
  periodes.forEach(p => {
    const row = document.createElement("tr");
    const tdName = document.createElement("td");
    tdName.innerHTML = `<strong>${p.Etudiant.prenom} ${p.Etudiant.nom}</strong>`;
    row.appendChild(tdName);

    for (let i = 0; i < daysInMonth; i++) {
      const td = document.createElement("td");
      td.textContent = "—";
      td.style.cursor = "pointer";
      td.onclick = () => alert("Clic sur case - à connecter à l'API");
      row.appendChild(td);
    }
    const tdC = document.createElement("td");
    tdC.innerHTML = `Fait: <strong>${formatH(p.FAIT||0)}</strong>`;
    row.appendChild(tdC);
    tbody.appendChild(row);
  });
  table.appendChild(tbody);
  container.appendChild(table);
}

/* === Rendu général simplifié === */

function renderServiceSelect() {
  const siteSel = $("site-select");
  if (!siteSel || !state.data) return;
  const services = state.data.services || [];
  const sites = [...new Set(services.map(s => s.Site || "Autre"))];
  siteSel.innerHTML = sites.map(s => `<option>${s}</option>`).join("");
  if (!state.selectedSite) state.selectedSite = sites[0];
  siteSel.value = state.selectedSite;

  const svcSel = $("service-select");
  const filtered = services.filter(s => (s.Site || "Autre") === state.selectedSite);
  svcSel.innerHTML = filtered.map(s => `<option value="${s.id}">${s.Nom}</option>`).join("");
  if (!state.selectedServiceId && filtered.length) state.selectedServiceId = filtered[0].id;
  svcSel.value = state.selectedServiceId;

  siteSel.onchange = () => { state.selectedSite = siteSel.value; renderServiceSelect(); renderActiveTab(); };
  svcSel.onchange = () => { state.selectedServiceId = Number(svcSel.value); renderActiveTab(); };
}

function renderMainTabs() {
  const bar = $("main-tabs");
  if (!bar) return;
  bar.innerHTML = "";
  const tabs = [
    {id:"dashboard", label:"Tableau de bord"},
    {id:"dossier", label:"Dossier étudiants"},
    {id:"planning", label:"Planning de service"},
    {id:"stats", label:"Statistiques"}
  ];
  tabs.forEach(t => {
    const b = el("button", "main-tab" + (state.activeTab === t.id ? " active" : ""), t.label);
    b.onclick = () => { state.activeTab = t.id; renderMainTabs(); renderActiveTab(); };
    bar.appendChild(b);
  });
}

function renderActiveTab() {
  ["dashboard","dossier","planning","stats"].forEach(id => {
    const el = $(`tab-${id}`);
    if (el) el.hidden = state.activeTab !== id;
  });
  if (state.activeTab === "planning") renderPlanningTab();
  // Ajoute ici les appels renderDossierTab(), renderDashboardTab() etc. quand tu les auras
}

function render() {
  renderServiceSelect();
  renderMainTabs();
  renderActiveTab();
}

function enterApp() {
  $("login-screen").hidden = true;
  $("app-screen").hidden = false;
  render();
}

/* Login */
$("login-form").onsubmit = async (e) => {
  e.preventDefault();
  try {
    state.email = $("login-email").value.trim();
    state.code = $("login-code").value.trim();
    state.data = await api("POST", "/api/cadre/login", {email: state.email, code: state.code});
    sessionStorage.setItem("cadre_email", state.email);
    sessionStorage.setItem("cadre_code", state.code);
    enterApp();
  } catch(err) {
    $("login-error").textContent = err.message;
    $("login-error").hidden = false;
  }
};

$("logout-btn").onclick = () => { sessionStorage.clear(); location.reload(); };
$("refresh-btn").onclick = async () => { state.data = await api("GET", "/api/cadre/data"); render(); };

/* Auto-login si déjà connecté */
if (state.email && state.code) {
  api("GET", "/api/cadre/data").then(d => { state.data = d; enterApp(); }).catch(() => {});
}

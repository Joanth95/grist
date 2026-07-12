/**
 * Proxy API entre l'espace étudiant (GitHub Pages) et le document Grist
 * GESTION-ETUDIANT (instance DINUM).
 *
 * La clé API Grist reste secrète ici (secret GRIST_API_KEY).
 * L'étudiant s'authentifie avec son code anonymat (1ère lettre du prénom
 * + date de naissance JJMMAA + 1ère lettre du nom, ex. J150398D), présent
 * dans LISTE_DES_ETUDIANTS.Anonymat et PERIODES_DE_STAGE.Code_anonymat.
 *
 * Modèle de données :
 *   PERIODES_DE_STAGE : une ligne par stage (Du, Au, Service, En_cours…)
 *   PLANNING_HEBDO    : une ligne par semaine de stage ; Lundi…Dimanche
 *                       référencent CODES_HORAIRES (M, S, N, R, ABS…)
 *
 * Endpoints (code anonymat dans l'en-tête X-Student-Code) :
 *   POST  /api/login          { code }   -> profil + périodes + semaines + codes
 *   GET   /api/data                      -> même payload (rafraîchissement)
 *   POST  /api/semaines       { Periode, Semaine_debut }        -> nouvelle semaine
 *   PATCH /api/semaines/:id   { Lundi…Dimanche, Commentaire }   -> modification
 */

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

const T_ETUDIANTS = "LISTE_DES_ETUDIANTS";
const T_PERIODES = "PERIODES_DE_STAGE";
const T_HEBDO = "PLANNING_HEBDO";
const T_CODES = "CODES_HORAIRES";
const T_SERVICES = "SERVICES";

const DAY_COLUMNS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    try {
      const response = await route(request, env);
      for (const [k, v] of Object.entries(cors)) response.headers.set(k, v);
      return response;
    } catch (err) {
      const status = err.status || 500;
      if (!err.status) console.error(err);
      return new Response(JSON.stringify({ error: err.publicMessage || "Erreur interne du serveur" }), {
        status,
        headers: { ...JSON_HEADERS, ...cors },
      });
    }
  },
};

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Student-Code",
    "Access-Control-Max-Age": "86400",
  };
}

function httpError(status, publicMessage) {
  const err = new Error(publicMessage);
  err.status = status;
  err.publicMessage = publicMessage;
  return err;
}

async function route(request, env) {
  const path = new URL(request.url).pathname.replace(/\/+$/, "");

  if (request.method === "POST" && path === "/api/login") {
    const body = await request.json().catch(() => ({}));
    const student = await authenticateCode(env, body.code);
    return json(await buildPayload(env, student));
  }

  const student = await authenticateCode(env, request.headers.get("X-Student-Code"));

  if (request.method === "GET" && path === "/api/data") {
    return json(await buildPayload(env, student));
  }
  if (request.method === "POST" && path === "/api/semaines") {
    return createWeek(request, env, student);
  }
  const m = path.match(/^\/api\/semaines\/(\d+)$/);
  if (request.method === "PATCH" && m) {
    return updateWeek(request, env, student, Number(m[1]));
  }

  throw httpError(404, "Route inconnue");
}

/* ------------------------------------------------------------------ */
/* Authentification                                                    */
/* ------------------------------------------------------------------ */

async function authenticateCode(env, code) {
  if (typeof code !== "string") throw httpError(401, "Code anonymat invalide");
  code = code.trim().toUpperCase();
  // Format attendu : 1 lettre + JJMMAA + 1 lettre (ex. J150398D)
  if (!/^[A-Z]\d{6}[A-Z]$/.test(code)) throw httpError(401, "Code anonymat invalide");

  const records = await gristFilter(env, T_ETUDIANTS, { Anonymat: [code] });
  if (records.length !== 1) throw httpError(401, "Code anonymat invalide");
  return { rowId: records[0].id, code, fields: records[0].fields };
}

/* ------------------------------------------------------------------ */
/* Lecture : payload complet pour l'étudiant                           */
/* ------------------------------------------------------------------ */

async function buildPayload(env, student) {
  const [periodes, services, codes] = await Promise.all([
    gristFilter(env, T_PERIODES, { Code_anonymat: [student.code] }),
    gristAll(env, T_SERVICES),
    gristAll(env, T_CODES),
  ]);

  const serviceName = new Map(services.map((s) => [s.id, s.fields.Nom || ""]));
  const periodeIds = periodes.map((p) => p.id);

  const semaines = periodeIds.length
    ? await gristFilter(env, T_HEBDO, { Periode: periodeIds })
    : [];

  return {
    etudiant: {
      prenom: student.fields.PRENOM || "",
      nom: student.fields.NOM || "",
    },
    periodes: periodes.map((p) => ({
      id: p.id,
      Du: epochToIso(p.fields.Du),
      Au: epochToIso(p.fields.Au),
      Service: serviceName.get(p.fields.Service) || "",
      Niveau: p.fields.Niveau || "",
      En_cours: !!p.fields.En_cours,
      A_FAIRE: p.fields.A_FAIRE ?? null,
      FAIT: p.fields.FAIT ?? null,
      Solde_heures: p.fields.Solde_heures ?? null,
      Tuteur: p.fields.Tuteur || "",
    })),
    semaines: semaines.map((s) => {
      const out = {
        id: s.id,
        Periode: s.fields.Periode,
        Semaine_debut: epochToIso(s.fields.Semaine_debut),
        Commentaire: s.fields.Commentaire || "",
        Total_h_semaine: s.fields.Total_h_semaine ?? null,
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
      Duree_heures: c.fields.Duree_heures ?? null,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Écriture : semaines de planning                                     */
/* ------------------------------------------------------------------ */

async function studentPeriodeIds(env, student) {
  const periodes = await gristFilter(env, T_PERIODES, { Code_anonymat: [student.code] });
  return periodes.map((p) => p.id);
}

async function sanitizeWeekFields(env, body) {
  const source = body.fields || body || {};
  const fields = {};
  if (source.Commentaire !== undefined) {
    fields.Commentaire = String(source.Commentaire).slice(0, 500);
  }
  const dayValues = DAY_COLUMNS.filter((d) => source[d] !== undefined);
  if (dayValues.length) {
    const codes = await gristAll(env, T_CODES);
    const validIds = new Set(codes.map((c) => c.id));
    for (const d of dayValues) {
      const v = Number(source[d]);
      if (v === 0) fields[d] = 0; // jour vide
      else if (validIds.has(v)) fields[d] = v;
      else throw httpError(400, `Code horaire inconnu pour ${d}`);
    }
  }
  return fields;
}

async function createWeek(request, env, student) {
  const body = await request.json().catch(() => ({}));
  const periodeId = Number(body.Periode);
  const semaineDebut = body.Semaine_debut;

  const allowed = await studentPeriodeIds(env, student);
  if (!allowed.includes(periodeId)) throw httpError(403, "Cette période de stage ne vous appartient pas");
  if (typeof semaineDebut !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(semaineDebut)) {
    throw httpError(400, "Date de début de semaine invalide");
  }
  const epoch = Date.parse(semaineDebut + "T00:00:00Z") / 1000;

  // Pas de doublon de semaine pour une même période
  const existing = await gristFilter(env, T_HEBDO, { Periode: [periodeId], Semaine_debut: [epoch] });
  if (existing.length) throw httpError(409, "Cette semaine existe déjà");

  const fields = await sanitizeWeekFields(env, body);
  fields.Periode = periodeId;
  fields.Semaine_debut = epoch;

  const data = await grist(env, "POST", `/tables/${T_HEBDO}/records`, { records: [{ fields }] });
  return json({ id: data.records[0].id }, 201);
}

async function updateWeek(request, env, student, rowId) {
  const rows = await gristFilter(env, T_HEBDO, { id: [rowId] });
  if (!rows.length) throw httpError(404, "Semaine introuvable");

  const allowed = await studentPeriodeIds(env, student);
  if (!allowed.includes(rows[0].fields.Periode)) {
    throw httpError(403, "Cette semaine ne vous appartient pas");
  }

  const fields = await sanitizeWeekFields(env, await request.json().catch(() => ({})));
  if (!Object.keys(fields).length) throw httpError(400, "Aucun champ à modifier");

  await grist(env, "PATCH", `/tables/${T_HEBDO}/records`, { records: [{ id: rowId, fields }] });
  return json({ ok: true });
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

/* ------------------------------------------------------------------ */
/* Utilitaires                                                         */
/* ------------------------------------------------------------------ */

function epochToIso(value) {
  if (typeof value !== "number") return value || null;
  return new Date(value * 1000).toISOString().slice(0, 10);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

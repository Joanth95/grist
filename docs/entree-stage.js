/* Entrée en stage — auto-inscription de l'étudiant */

const API = window.CONFIG.API_URL.replace(/\/$/, "");
const $ = (id) => document.getElementById(id);

async function init() {
  try {
    const res = await fetch(API + "/api/services");
    const ref = await res.json();
    if (!res.ok) throw new Error(ref.error || "Erreur de chargement");

    fillSelect("f-civilite", ref.civilites.map((c) => [c, c]));
    fillSelect("f-formation", ref.formations.map((f) => [f, f]));
    fillSelect("f-niveau", ref.niveaux.map((n) => [n, n]));
    fillSelect("f-service", ref.services.map((s) => [s.id, s.Nom]));
  } catch (err) {
    const errEl = $("form-error");
    errEl.textContent = "Impossible de charger le formulaire : " + err.message;
    errEl.hidden = false;
    $("submit-btn").disabled = true;
  }
}

function fillSelect(id, pairs) {
  const select = $(id);
  select.innerHTML = "";
  select.appendChild(new Option("— Choisir —", ""));
  for (const [value, label] of pairs) select.appendChild(new Option(label, value));
}

$("inscription-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = $("form-error");
  errEl.hidden = true;

  const du = $("f-du").value;
  const au = $("f-au").value;
  if (du && au && au < du) {
    errEl.textContent = "La fin du stage doit être après le début.";
    errEl.hidden = false;
    return;
  }

  const body = {
    Civilite: $("f-civilite").value,
    NOM: $("f-nom").value.trim(),
    PRENOM: $("f-prenom").value.trim(),
    DDN: $("f-ddn").value,
    FORMATION: $("f-formation").value,
    Centre_de_formation: $("f-centre").value.trim(),
    Adresse_mail: $("f-email").value.trim(),
    Numero_de_telephone: $("f-tel").value.trim(),
    website: $("f-website").value, // champ-piège
    periode: {
      Service: Number($("f-service").value),
      Niveau: $("f-niveau").value,
      Du: du,
      Au: au,
      Tuteur: $("f-tuteur").value.trim(),
    },
  };

  const btn = $("submit-btn");
  btn.disabled = true;
  btn.textContent = "Enregistrement…";
  try {
    const res = await fetch(API + "/api/inscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);

    $("form-screen").hidden = true;
    $("success-screen").hidden = false;
    $("code-display").textContent = data.code;
    if (data.dejaInscrit) {
      $("success-message").textContent =
        "Vous étiez déjà connu du service : votre nouvelle période de stage a été ajoutée à votre dossier.";
    }
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "Enregistrer mon entrée en stage";
  }
});

init();

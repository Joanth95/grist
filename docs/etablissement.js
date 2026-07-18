/* Identité de l'établissement affichée dans l'en-tête et le pied de page.
   © Joan Thuillier — Tous droits réservés. Voir LICENSE à la racine du dépôt.

   Les valeurs viennent de la table Grist ETABLISSEMENT (endpoint public
   /api/config du Worker) : l'application reste générique et peut être
   déployée dans n'importe quel établissement sans toucher au code.
   Un cache localStorage évite le clignotement au chargement. */

(function () {
  const KEY = "etablissement-config";

  function fill(cfg) {
    if (!cfg) return;
    document.querySelectorAll(".js-etab").forEach((bloc) => {
      const nom = bloc.querySelector(".js-etab-nom");
      const desc = bloc.querySelector(".js-etab-desc");
      if (nom) nom.textContent = cfg.nom || "";
      if (desc) {
        desc.textContent = cfg.description || "";
        desc.hidden = !cfg.description;
      }
      bloc.hidden = !cfg.nom;
    });
    if (cfg.sousTitre) {
      document.querySelectorAll(".js-etab-tagline").forEach((t) => {
        t.textContent = cfg.sousTitre;
      });
    }
  }

  // Affichage immédiat depuis le cache, puis rafraîchissement en arrière-plan
  try { fill(JSON.parse(localStorage.getItem(KEY) || "null")); } catch { /* cache illisible : ignoré */ }

  const api = ((window.CONFIG && window.CONFIG.API_URL) || "").replace(/\/$/, "");
  if (!api) return;
  fetch(api + "/api/config")
    .then((r) => (r.ok ? r.json() : null))
    .then((cfg) => {
      if (!cfg || typeof cfg.nom !== "string") return;
      try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* stockage plein : ignoré */ }
      fill(cfg);
    })
    .catch(() => { /* hors-ligne : on garde le cache ou l'affichage générique */ });
})();

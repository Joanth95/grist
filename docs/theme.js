/* Bascule d'habillage visuel (public/DSFR ou moderne), posée avant le premier
   affichage pour éviter le clignotement. À charger en tout premier dans
   <head>, sans defer/async : relit le cache localStorage rempli par
   etablissement.js lors d'une visite précédente. Sans cache (1re visite),
   le rendu reste "public" (DSFR) par défaut, comme aujourd'hui ;
   etablissement.js recale l'attribut dès que /api/config répond.
   © Joan Thuillier — Tous droits réservés. Voir LICENSE à la racine du dépôt. */
(function () {
  try {
    var cfg = JSON.parse(localStorage.getItem("etablissement-config") || "null");
    if (cfg && cfg.modeEtablissementPublic === false) {
      document.documentElement.setAttribute("data-theme", "modern");
    }
  } catch (e) { /* cache illisible : on garde le rendu public par défaut */ }
})();

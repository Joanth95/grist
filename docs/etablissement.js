/* Identité de l'établissement affichée dans l'en-tête et le pied de page.
   © Joan Thuillier — Tous droits réservés. Voir LICENSE à la racine du dépôt.

   Les valeurs viennent de la table Grist ETABLISSEMENT (endpoint public
   /api/config du Worker) : l'application reste générique et peut être
   déployée dans n'importe quel établissement sans toucher au code.
   Un cache localStorage évite le clignotement au chargement. */

(function () {
  const KEY = "etablissement-config";

  /* Espace cadre, thèmes public et moderne : fusionne les deux bandeaux en
     déplaçant le contexte site/service et l'avatar dans .fr-header-tools
     (même ligne que le titre de page), plutôt qu'une barre .app-header à
     part. No-op sur les autres pages (éléments absents). */
  function relocateHeaderCadre() {
    // #app-screen a son propre .fr-header-tools, distinct de celui de
    // #login-screen (toujours présent dans le DOM, même masqué) : cibler
    // le bon pour ne pas déplacer les éléments dans l'en-tête invisible.
    const tools = document.querySelector("#app-screen .fr-header-tools");
    const ctxWrap = document.getElementById("cadreCtxWrap");
    const iconBtn = document.getElementById("modernRefreshBtn");
    const info = document.getElementById("cadre-info");
    if (!tools || !ctxWrap || !iconBtn || !info) return;
    if (tools.contains(info)) return; // déjà déplacé
    tools.appendChild(ctxWrap);
    tools.appendChild(iconBtn);
    tools.appendChild(info);
  }

  /* Monogramme de repli (2 lettres) affiché à côté du titre de page en
     thème moderne, uniquement quand l'établissement n'a pas de logo Grist
     (voir fill()) — même principe que le carré généré sur la fiche de stage
     imprimée. Ex. « UN CHR » -> « UC ». */
  function brandInitials(name) {
    const diacritics = new RegExp("[̀-ͯ]", "g");
    const words = (name || "")
      .normalize("NFD").replace(diacritics, "")
      .trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "";
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0].charAt(0) + words[1].replace(/^[^A-Za-z]+/, "").charAt(0)).toUpperCase();
  }

  function fill(cfg) {
    if (!cfg) return;
    // Habillage du site : "public" (DSFR, défaut) ou "modern" (colonne
    // ETABLISSEMENT.Mode_etablissement_public décochée). Posé au plus tôt
    // par le script inline en tête de page (cache localStorage) ; ici on
    // recale après la réponse réseau si elle diffère du cache.
    document.documentElement.setAttribute("data-theme", cfg.modeEtablissementPublic === false ? "modern" : "public");
    relocateHeaderCadre();
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
    // Lien « Administration (Grist) » du pied de page : piloté par la colonne
    // ETABLISSEMENT.Url_document_grist ; vide -> layout.js garde son lien par défaut.
    if (cfg.urlDocumentGrist) {
      document.querySelectorAll(".js-etab-admin").forEach((a) => {
        a.href = cfg.urlDocumentGrist;
      });
    }
    // Texte du pied de page : piloté par la colonne facultative
    // ETABLISSEMENT.Texte_pied_de_page ; vide -> texte par défaut de layout.js.
    if (cfg.textePiedDePage) {
      document.querySelectorAll(".js-etab-footer-desc").forEach((p) => {
        p.textContent = cfg.textePiedDePage;
      });
    }
    // Bandeau « Version bêta » (haut de page + mention du pied) : masqué quand
    // la bascule ETABLISSEMENT.Afficher_bandeau_beta est décochée.
    if (cfg.afficherBeta === false) {
      document.querySelectorAll(".fr-notice, .js-beta-mention").forEach((el) => {
        el.hidden = true;
      });
    }
    // Domaine mail de l'établissement (colonne facultative DOMAINE_MAIL) :
    // ajuste les placeholders des champs email et complète automatiquement
    // « prenom.nom » en « prenom.nom@domaine » à la sortie du champ.
    if (cfg.domaineMail) {
      const dom = cfg.domaineMail;
      document.querySelectorAll('input[type="email"]').forEach((inp) => {
        inp.placeholder = "prenom.nom@" + dom;
        if (inp.dataset.domaineMailBranche) return;
        inp.dataset.domaineMailBranche = "1";
        inp.addEventListener("blur", () => {
          const v = inp.value.trim();
          if (v && !v.includes("@")) inp.value = v + "@" + dom;
        });
      });
    }

    // Logo de l'établissement (pièce jointe Grist servie par le Worker) ;
    // ?v=<logoId> invalide le cache navigateur quand le logo change.
    const api2 = ((window.CONFIG && window.CONFIG.API_URL) || "").replace(/\/$/, "");
    document.querySelectorAll(".js-etab-logo").forEach((img) => {
      if (cfg.logoId && api2) {
        img.src = api2 + "/api/config/logo?v=" + encodeURIComponent(cfg.logoId);
        img.hidden = false;
      } else {
        img.hidden = true;
        img.removeAttribute("src");
      }
    });

    // Monogramme de repli (initiales de l'établissement) : seulement en
    // l'absence de logo, pour ne pas doubler l'identité visuelle.
    const hasLogo = !!(cfg.logoId && api2);
    document.querySelectorAll(".brand-mark").forEach((m) => {
      m.style.display = hasLogo ? "none" : "";
      if (!hasLogo) m.textContent = brandInitials(cfg.nom);
    });
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

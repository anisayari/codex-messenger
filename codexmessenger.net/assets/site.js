(() => {
  const svg = document.querySelector("svg");
  const mobileSite = document.querySelector(".mobile-site");
  const mobileFeedback = document.getElementById("mobileFeedback");
  const feedbackText = document.getElementById("feedbackText");
  const feedbackRipple = document.getElementById("feedbackRipple");
  const langLinks = document.querySelectorAll('[data-action="language"]');
  const downloadTriggers = document.querySelectorAll("[data-download-modal]");
  const downloadModal = document.getElementById("downloadModal");
  const downloadModalClose = document.getElementById("downloadModalClose");
  const actionElements = langLinks;

  const copy = {
  "en": {
    "selected": "English selected",
    "download": "Opening GitHub release…",
    "downloadMenu": "Choose your download…",
    "downloadTitle": "Download Codex Messenger",
    "downloadSubtitle": "Open the official GitHub release and choose the installer for your computer.",
    "downloadMac": "macOS · Apple Silicon",
    "downloadMacNote": "Choose the arm64 DMG on GitHub",
    "downloadIntel": "macOS · Intel",
    "downloadIntelNote": "Choose the x64 DMG on GitHub",
    "downloadWindows": "Windows · x64",
    "downloadWindowsNote": "Choose the x64 installer on GitHub",
    "downloadClose": "Close download chooser",
    "downloadButton": "DOWNLOAD",
    "downloadVersionPrefix": "download version",
    "source": "Opening source code…",
    "taglineOne": "Modern Codex. Classic MSN.",
    "taglineTwo": "Your coding, with childhood memories.",
    "aiLine": "Codex 0.156.1 required. Voice: account/server access and mic permission.",
    "featureOne": "Models, skills, MCP and approvals",
    "featureTwo": "Files, history, search and terminal",
    "featureThree": "69 classic emoticons & 15 real winks",
    "featureFour": "Voice controls, diagrams & equations",
    "featureFive": "Local tic-tac-toe. Open-source code.",
    "downloadNote": "Get Codex Messenger now!",
    "sourceTitle": "Open-source client",
    "sourceOne": "The app code is open source.",
    "sourceTwo": "Read the changelog and validation",
    "sourceThree": "and help make it even better.",
    "sourceLinkOne": "View source",
    "sourceLinkTwo": "on GitHub",
    "sourceMobile": "Explore the app code, changelog and validation on GitHub.",
    "socialTitle": "Developed with fun by Anis Ayari and Codex",
    "footerTagline": "Bringing back the vibes. Powered by ",
    "previewCaption": "Sample conversation · isolated demo contacts",
    "previewConversation": "Production renderer with a sample conversation",
    "previewRoster": "Isolated demo contact list, not connected MSN users",
    "pageDescription": "A retro MSN-inspired desktop client for Codex, with models, skills, MCP, approvals, history, terminals, original emoticons and winks.",
    "svgDescription": "Codex Messenger, a retro desktop client for Codex, with verified features, a GitHub release chooser and source code links."
  },
  "fr": {
    "selected": "Français sélectionné",
    "download": "Ouverture de la release GitHub…",
    "downloadMenu": "Choisissez votre téléchargement…",
    "downloadTitle": "Télécharger Codex Messenger",
    "downloadSubtitle": "Ouvrez la release GitHub officielle et choisissez l’installeur pour votre ordinateur.",
    "downloadMac": "macOS · Apple Silicon",
    "downloadMacNote": "Choisissez le DMG arm64 sur GitHub",
    "downloadIntel": "macOS · Intel",
    "downloadIntelNote": "Choisissez le DMG x64 sur GitHub",
    "downloadWindows": "Windows · x64",
    "downloadWindowsNote": "Choisissez l’installeur x64 sur GitHub",
    "downloadClose": "Fermer le choix de téléchargement",
    "downloadButton": "TÉLÉCHARGER",
    "downloadVersionPrefix": "télécharger la version",
    "source": "Ouverture du code source…",
    "taglineOne": "Codex moderne. MSN classique.",
    "taglineTwo": "Votre code et vos souvenirs d’enfance.",
    "aiLine": "Codex 0.156.1 requis. Voix selon compte, serveur et autorisation du micro.",
    "featureOne": "Modèles, skills, MCP et approvals",
    "featureTwo": "Fichiers, historique et terminal",
    "featureThree": "69 émoticônes et 15 clins d’œil MSN",
    "featureFour": "Voix, diagrammes et équations",
    "featureFive": "Morpion local. Code open source.",
    "downloadNote": "Téléchargez Codex Messenger !",
    "sourceTitle": "Client open source",
    "sourceOne": "Le code de l’app est open source.",
    "sourceTwo": "Consultez le changelog et les tests",
    "sourceThree": "et contribuez au projet.",
    "sourceLinkOne": "Voir le code",
    "sourceLinkTwo": "sur GitHub",
    "sourceMobile": "Consultez le code, le changelog et les tests sur GitHub.",
    "socialTitle": "Développé avec fun par Anis Ayari et Codex",
    "footerTagline": "Retour aux vibes MSN. Propulsé par ",
    "previewCaption": "Conversation exemple · contacts de démonstration",
    "previewConversation": "Renderer de production avec une conversation exemple",
    "previewRoster": "Liste de contacts de démonstration isolée, sans utilisateurs MSN connectés",
    "pageDescription": "Un client rétro inspiré de MSN pour Codex : modèles, skills, MCP, approvals, historique, terminaux, émoticônes et clins d’œil originaux.",
    "svgDescription": "Codex Messenger, un client rétro pour Codex, avec des fonctions vérifiées, les téléchargements GitHub et le code source."
  }
};

  let feedbackTimer = 0;

  const byId = (id) => document.getElementById(id);

  const setText = (id, value) => {
    const element = byId(id);
    if (element) {
      element.textContent = value;
    }
  };

  const setFeedbackMessage = (action, lang) => {
    document.querySelectorAll(`[data-action="${action}"]`).forEach((element) => {
      element.dataset.feedback = copy[lang][action] || element.dataset.feedback || "";
    });
  };

  const applyCopy = (lang) => {
    const text = copy[lang] || copy.en;

    setText("desktopTaglineOne", text.taglineOne);
    setText("desktopTaglineTwo", text.taglineTwo);
    setText("desktopAiLine", text.aiLine);
    setText("desktopFeatureOne", text.featureOne);
    setText("desktopFeatureTwo", text.featureTwo);
    setText("desktopFeatureThree", text.featureThree);
    setText("desktopFeatureFour", text.featureFour);
    setText("desktopFeatureFive", text.featureFive);
    setText("desktopDownloadNote", text.downloadNote);
    setText("desktopSourceTitle", text.sourceTitle);
    setText("desktopSourceOne", text.sourceOne);
    setText("desktopSourceTwo", text.sourceTwo);
    setText("desktopSourceThree", text.sourceThree);
    setText("desktopSourceLinkOne", text.sourceLinkOne);
    setText("desktopSourceLinkTwo", text.sourceLinkTwo);
    setText("desktopSocialTitle", text.socialTitle);
    setText("desktopFooterTagline", text.footerTagline);
    setText("downloadModalTitle", text.downloadTitle);
    setText("downloadModalSubtitle", text.downloadSubtitle);
    setText("downloadMacLabel", text.downloadMac);
    setText("downloadMacNote", text.downloadMacNote);
    setText("downloadWindowsLabel", text.downloadWindows);
    setText("downloadWindowsNote", text.downloadWindowsNote);

    setText("mobileTaglineOne", text.taglineOne);
    setText("mobileTaglineTwo", text.taglineTwo);
    setText("mobileAiLine", text.aiLine);
    setText("mobileDownloadNote", text.downloadNote);
    setText("mobileFeatureOne", text.featureOne);
    setText("mobileFeatureTwo", text.featureTwo);
    setText("mobileFeatureThree", text.featureThree);
    setText("mobileFeatureFour", text.featureFour);
    setText("mobileFeatureFive", text.featureFive);
    setText("mobileSourceTitle", text.sourceTitle);
    setText("mobileSourceText", text.sourceMobile);
    setText("mobileFooterTagline", text.footerTagline + "Codex.");

    setText("downloadIntelLabel", text.downloadIntel);
    setText("downloadIntelNote", text.downloadIntelNote);
    setText("page-desc", text.svgDescription);
    document.querySelectorAll("[data-download-label]").forEach(element => { element.textContent = text.downloadButton; });
    document.querySelectorAll("[data-release-label]").forEach(element => { element.textContent = text.downloadVersionPrefix + " v0.0.4"; });
    document.querySelectorAll("[data-preview-caption]").forEach(element => { element.textContent = text.previewCaption; });
    document.querySelectorAll("[data-preview-conversation]").forEach(element => { element.alt = text.previewConversation; });
    document.querySelectorAll("[data-preview-roster]").forEach(element => { element.alt = text.previewRoster; });
    downloadModalClose?.setAttribute("aria-label", text.downloadClose);
    document.querySelector('meta[name="description"]')?.setAttribute("content", text.pageDescription);
    document.querySelector('meta[property="og:description"]')?.setAttribute("content", text.pageDescription);
    document.querySelector('meta[name="twitter:description"]')?.setAttribute("content", text.pageDescription);
    document.querySelector('meta[property="og:locale"]')?.setAttribute("content", lang === "fr" ? "fr_FR" : "en_US");
    document.querySelector('meta[property="og:locale:alternate"]')?.setAttribute("content", lang === "fr" ? "en_US" : "fr_FR");

    setFeedbackMessage("download", lang);
    setFeedbackMessage("source", lang);

    downloadTriggers.forEach((element) => {
      element.dataset.feedback = text.downloadMenu;
    });
  };

  const isMobileVisible = () => {
    return mobileSite && window.getComputedStyle(mobileSite).display !== "none";
  };

  const toSvgPoint = (event, element) => {
    const point = svg.createSVGPoint();
    if (typeof event.clientX === "number" && typeof event.clientY === "number") {
      point.x = event.clientX;
      point.y = event.clientY;
    } else {
      const box = element.getBoundingClientRect();
      point.x = box.left + box.width / 2;
      point.y = box.top + box.height / 2;
    }

    const matrix = svg.getScreenCTM();
    return matrix ? point.matrixTransform(matrix.inverse()) : point;
  };

  const showMobileFeedback = (message) => {
    if (!mobileFeedback) {
      return;
    }

    mobileFeedback.textContent = message;
    mobileFeedback.classList.remove("is-on");
    void mobileFeedback.getBoundingClientRect();
    mobileFeedback.classList.add("is-on");
    clearTimeout(feedbackTimer);
    feedbackTimer = window.setTimeout(() => mobileFeedback.classList.remove("is-on"), 1350);
  };

  const showSvgFeedback = (message, event, element) => {
    if (!svg || !feedbackText || !feedbackRipple) {
      return;
    }

    const point = toSvgPoint(event, element);
    feedbackText.textContent = message;
    feedbackRipple.setAttribute("cx", String(point.x));
    feedbackRipple.setAttribute("cy", String(point.y));

    feedbackRipple.classList.remove("is-on");
    void feedbackRipple.getBoundingClientRect();
    feedbackRipple.classList.add("is-on");

    svg.classList.add("feedback-on");
    clearTimeout(feedbackTimer);
    feedbackTimer = window.setTimeout(() => {
      svg.classList.remove("feedback-on");
      feedbackRipple.classList.remove("is-on");
    }, 1350);
  };

  const showFeedback = (message, event, element) => {
    if (isMobileVisible()) {
      showMobileFeedback(message);
    } else {
      showSvgFeedback(message, event, element);
    }

    if ("vibrate" in navigator) {
      navigator.vibrate(18);
    }
  };

  const press = (element) => {
    element.classList.add("is-pressed");
    window.setTimeout(() => element.classList.remove("is-pressed"), 170);
  };

  let lastDownloadTrigger = null;

  const openDownloadModal = (event, element) => {
    if (!downloadModal) {
      return;
    }

    lastDownloadTrigger = element;
    downloadModal.hidden = false;
    document.body.classList.add("download-modal-open");
    document.querySelectorAll("main.site, main.mobile-site").forEach(element => { element.inert = true; });
    showFeedback(element.dataset.feedback || "Choose your download...", event, element);
    window.setTimeout(() => downloadModalClose?.focus(), 0);
  };

  const closeDownloadModal = () => {
    if (!downloadModal || downloadModal.hidden) {
      return;
    }

    downloadModal.hidden = true;
    document.body.classList.remove("download-modal-open");
    document.querySelectorAll("main.site, main.mobile-site").forEach(element => { element.inert = false; });
    lastDownloadTrigger?.focus?.();
    lastDownloadTrigger = null;
  };

  const setLanguage = (lang, updateUrl = true) => {
    const normalized = lang === "fr" ? "fr" : "en";
    const text = copy[normalized];

    langLinks.forEach((item) => {
      const isActive = item.dataset.lang === normalized;
      item.classList.toggle("is-active", isActive);
      item.setAttribute("aria-current", isActive ? "true" : "false");
      item.dataset.feedback = isActive ? text.selected : copy[item.dataset.lang === "fr" ? "fr" : "en"].selected;
    });

    document.documentElement.lang = normalized;
    applyCopy(normalized);

    if (updateUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set("lang", normalized);
      if (url.href !== window.location.href) window.history.pushState(null, "", url);
    }
  };

  const initialLanguage = () => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("lang");
    if (requested === "fr" || requested === "en") {
      return requested;
    }

    return "en";
  };

  actionElements.forEach((element) => {
    element.addEventListener("pointerdown", () => press(element));
    element.addEventListener("click", (event) => {
      const action = element.dataset.action || "";
      const message = element.dataset.feedback || "Working...";

      showFeedback(message, event, element);

      if (action === "language") {
        event.preventDefault();
        setLanguage(element.dataset.lang || "en");
        return;
      }

      return;
    });
  });

  downloadTriggers.forEach((element) => {
    element.addEventListener("pointerdown", () => press(element));
    element.addEventListener("click", (event) => {
      event.preventDefault();
      openDownloadModal(event, element);
    });
  });

  downloadModalClose?.addEventListener("click", closeDownloadModal);
  downloadModal?.addEventListener("click", (event) => {
    if (event.target === downloadModal) {
      closeDownloadModal();
      return;
    }

    if (event.target.closest("[data-download-link]")) {
      window.setTimeout(closeDownloadModal, 80);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (!downloadModal || downloadModal.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeDownloadModal();
      return;
    }
    if (event.key === "Tab") {
      const focusable = Array.from(downloadModal.querySelectorAll('button:not([disabled]), a[href]')).filter(element => element.getClientRects().length);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || !downloadModal.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !downloadModal.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    }
  });

  window.addEventListener("popstate", () => setLanguage(initialLanguage(), false));
  setLanguage(initialLanguage(), false);
})();

(() => {
  const svg = document.querySelector("svg");
  const mobileSite = document.querySelector(".mobile-site");
  const mobileFeedback = document.getElementById("mobileFeedback");
  const feedbackText = document.getElementById("feedbackText");
  const feedbackRipple = document.getElementById("feedbackRipple");
  const actionElements = document.querySelectorAll(".pressable, .pressable-ui");
  const langLinks = document.querySelectorAll('[data-action="language"]');

  const copy = {
    en: {
      selected: "English mode selected",
      download: "Download starting...",
      source: "Opening source code...",
      taglineOne: "All Codex functionality...",
      taglineTwo: "but with your childhood memories !",
      aiLine: "you have lost your old friends, but now you can talk with your AI friends !",
      featureOne: "Classic look & feel from the 2000s",
      featureTwo: "Private messaging like MSN",
      featureThree: "Emoticons, winks and more!",
      featureFour: "Lightweight and blazing fast",
      featureFive: "Secure, modern and Open Source",
      downloadNote: "Get Codex Messenger Now !",
      sourceTitle: "Open Source Project",
      sourceOne: "Codex Messenger is 100% Open Source.",
      sourceTwo: "Check out the code, contribute and",
      sourceThree: "help make it even better!",
      sourceLinkOne: "View Source",
      sourceLinkTwo: "on GitHub",
      sourceMobile: "Codex Messenger is 100% Open Source. View Source on GitHub.",
      socialTitle: "Developed with fun by Anis Ayari and Codex",
      footerTagline: "Bringing back the vibes. Powered by "
    },
    fr: {
      selected: "Mode francais selectionne",
      download: "Telechargement lance...",
      source: "Ouverture du code source...",
      taglineOne: "Toute la puissance de Codex...",
      taglineTwo: "avec tes souvenirs d'enfance !",
      aiLine: "tu as perdu tes anciens amis, mais maintenant tu peux parler avec tes amis IA !",
      featureOne: "Look classique des annees 2000",
      featureTwo: "Messagerie privee comme MSN",
      featureThree: "Emoticones, winks et plus encore !",
      featureFour: "Leger et ultra rapide",
      featureFive: "Securise, moderne et Open Source",
      downloadNote: "Telecharge Codex Messenger !",
      sourceTitle: "Projet Open Source",
      sourceOne: "Codex Messenger est 100% Open Source.",
      sourceTwo: "Regarde le code, contribue et",
      sourceThree: "aide a l'ameliorer !",
      sourceLinkOne: "Voir le code",
      sourceLinkTwo: "sur GitHub",
      sourceMobile: "Codex Messenger est 100% Open Source. Voir le code sur GitHub.",
      socialTitle: "Developpe avec fun par Anis Ayari et Codex",
      footerTagline: "Retour aux vibes MSN. Propulse par "
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

    setFeedbackMessage("download", lang);
    setFeedbackMessage("source", lang);
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

  const triggerDownload = (link) => {
    window.setTimeout(() => {
      const temporaryLink = document.createElement("a");
      temporaryLink.href = link.href;
      temporaryLink.download = link.getAttribute("download") || "";
      temporaryLink.rel = "noopener";
      document.body.appendChild(temporaryLink);
      temporaryLink.click();
      temporaryLink.remove();
    }, 220);
  };

  const openExternal = (link) => {
    window.open(link.href, "_blank", "noopener,noreferrer");
  };

  const setLanguage = (lang, persist = true) => {
    const normalized = lang === "fr" ? "fr" : "en";
    const text = copy[normalized];

    langLinks.forEach((item) => {
      const isActive = item.dataset.lang === normalized;
      item.classList.toggle("is-active", isActive);
      item.setAttribute("aria-pressed", String(isActive));
      item.dataset.feedback = isActive ? text.selected : copy[item.dataset.lang === "fr" ? "fr" : "en"].selected;
    });

    document.documentElement.lang = normalized;
    applyCopy(normalized);

    if (persist) {
      try {
        window.localStorage.setItem("codexMessengerLang", normalized);
      } catch {
        // localStorage can be blocked; language switching should still work.
      }
    }
  };

  const initialLanguage = () => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("lang");
    if (requested === "fr" || requested === "en") {
      return requested;
    }

    try {
      const saved = window.localStorage.getItem("codexMessengerLang");
      if (saved === "fr" || saved === "en") {
        return saved;
      }
    } catch {
      return "en";
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

      if (action === "download") {
        event.preventDefault();
        triggerDownload(element);
        return;
      }

      if (action === "source" || action === "social") {
        event.preventDefault();
        openExternal(element);
      }
    });
  });

  setLanguage(initialLanguage(), false);
})();

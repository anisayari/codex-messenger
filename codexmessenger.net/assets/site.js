(() => {
  const svg = document.querySelector("svg");
  const feedbackLayer = document.getElementById("feedbackLayer");
  const feedbackText = document.getElementById("feedbackText");
  const feedbackRipple = document.getElementById("feedbackRipple");
  const pressables = document.querySelectorAll(".pressable");
  const langLinks = document.querySelectorAll(".lang-link");

  if (!svg || !feedbackLayer || !feedbackText || !feedbackRipple) {
    return;
  }

  let feedbackTimer = 0;

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

    return point.matrixTransform(svg.getScreenCTM().inverse());
  };

  const showFeedback = (message, event, element) => {
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
    }, 360);
  };

  const openExternal = (link) => {
    window.open(link.href, "_blank", "noopener,noreferrer");
  };

  const setLanguage = (link) => {
    langLinks.forEach((item) => item.classList.remove("is-active"));
    link.classList.add("is-active");
    document.documentElement.lang = link.dataset.lang || "en";
  };

  pressables.forEach((element) => {
    element.addEventListener("pointerdown", () => press(element));
    element.addEventListener("click", (event) => {
      const action = element.dataset.action || "";
      const message = element.dataset.feedback || "Working...";

      showFeedback(message, event, element);

      if (action === "language") {
        event.preventDefault();
        setLanguage(element);
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
})();

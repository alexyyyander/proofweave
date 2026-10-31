/* Proofweave v1 — small interactive runtime. No dependencies. */
(() => {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------------------------------------------------- nav active */
  const here = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  document.querySelectorAll(".pw-nav a").forEach((link) => {
    const target = (link.getAttribute("href") || "").toLowerCase();
    if (target === here) link.setAttribute("aria-current", "page");
  });

  /* ---------------------------------------------------------- segmented */
  function layoutThumb(seg) {
    const thumb = seg.querySelector(".segmented-thumb");
    const current = seg.querySelector('[aria-selected="true"]');
    if (!thumb || !current) return;
    thumb.style.width = `${current.offsetWidth}px`;
    thumb.style.transform = `translateX(${current.offsetLeft}px)`;
  }

  function initSegmented(seg) {
    if (!seg.querySelector(".segmented-thumb")) {
      const thumb = document.createElement("span");
      thumb.className = "segmented-thumb";
      thumb.setAttribute("aria-hidden", "true");
      seg.prepend(thumb);
    }
    const buttons = [...seg.querySelectorAll("button")];
    seg.setAttribute("role", "tablist");
    buttons.forEach((b, i) => {
      if (!b.hasAttribute("aria-selected")) b.setAttribute("aria-selected", i === 0 ? "true" : "false");
      b.addEventListener("click", () => select(b));
    });
    function select(button) {
      buttons.forEach((b) => b.setAttribute("aria-selected", String(b === button)));
      layoutThumb(seg);
      seg.dispatchEvent(new CustomEvent("segment:change", { detail: { value: button.dataset.value, button } }));
    }
    layoutThumb(seg);
    requestAnimationFrame(() => layoutThumb(seg));
    seg._relayout = () => layoutThumb(seg);
  }

  document.querySelectorAll(".segmented").forEach(initSegmented);
  window.addEventListener("resize", () => document.querySelectorAll(".segmented").forEach((s) => s._relayout && s._relayout()));

  /* ---------------------------------------------------------- roving focus */
  document.querySelectorAll("[data-roving]").forEach((group) => {
    const items = [...group.querySelectorAll("[data-roving-item]")];
    if (!items.length) return;
    items.forEach((item, i) => { item.tabIndex = i === 0 ? 0 : -1; });
    group.addEventListener("keydown", (event) => {
      const current = document.activeElement;
      const index = items.indexOf(current);
      if (index === -1) return;
      let next = -1;
      const cols = group.dataset.roving === "grid" ? Number(group.dataset.cols || 3) : 1;
      switch (event.key) {
        case "ArrowRight": next = index + 1; break;
        case "ArrowLeft": next = index - 1; break;
        case "ArrowDown": next = group.dataset.roving === "grid" ? index + cols : index + 1; break;
        case "ArrowUp": next = group.dataset.roving === "grid" ? index - cols : index - 1; break;
        case "Home": next = 0; break;
        case "End": next = items.length - 1; break;
        default: return;
      }
      if (event.key === "ArrowDown" && group.dataset.roving !== "grid" && index === items.length - 1) next = index;
      next = Math.max(0, Math.min(items.length - 1, next));
      if (next === index) return;
      event.preventDefault();
      items.forEach((item, i) => { item.tabIndex = i === next ? 0 : -1; });
      items[next].focus();
    });
  });

  /* ---------------------------------------------------------- scroll fade sensor */
  const faders = [...document.querySelectorAll(".scroll-fade")];
  function updateFade(el) {
    const max = 34;
    const top = Math.min(el.scrollTop, max);
    const bottom = Math.min(el.scrollHeight - el.clientHeight - el.scrollTop, max);
    el.style.setProperty("--fade-top", `${top}px`);
    el.style.setProperty("--fade-bottom", `${bottom}px`);
  }
  const raf = (fn) => { let queued = false; return () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; fn(); }); }; };
  const updateAllFades = raf(() => faders.forEach(updateFade));
  faders.forEach((el) => { el.addEventListener("scroll", () => updateFade(el), { passive: true }); updateFade(el); });
  window.addEventListener("resize", updateAllFades);
  updateAllFades();

  /* ---------------------------------------------------------- overlay / drawer */
  function openOverlay(id, trigger) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add("is-open");
    el._trigger = trigger || null;
    const focusable = el.querySelector(".drawer [data-autofocus], .drawer a, .drawer button");
    if (focusable) focusable.focus();
    const onKey = (e) => { if (e.key === "Escape") closeOverlay(el); };
    el._onKey = onKey;
    document.addEventListener("keydown", onKey);
  }
  function closeOverlay(el) {
    el.classList.remove("is-open");
    if (el._onKey) document.removeEventListener("keydown", el._onKey);
    if (el._trigger) el._trigger.focus();
  }
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-open]");
    if (trigger) { event.preventDefault(); openOverlay(trigger.dataset.open, trigger); return; }
    const closer = event.target.closest("[data-close]");
    if (closer) { const el = closer.closest(".overlay"); if (el) closeOverlay(el); return; }
    if (event.target.classList.contains("overlay")) closeOverlay(event.target);
  });

  /* ---------------------------------------------------------- catalog filter */
  document.querySelectorAll("[data-filter-target]").forEach((seg) => {
    seg.addEventListener("segment:change", (event) => {
      const value = event.detail.value;
      const scope = document.querySelector(seg.dataset.filterTarget);
      if (!scope) return;
      let shown = 0;
      scope.querySelectorAll("[data-subject]").forEach((card) => {
        const match = value === "all" || card.dataset.subject === value;
        card.hidden = !match;
        if (match) shown += 1;
      });
      const counter = document.querySelector(seg.dataset.filterCount || "");
      if (counter) counter.textContent = `${shown} shown`;
    });
  });

  /* ---------------------------------------------------------- IME-safe composer */
  document.querySelectorAll("[data-composer]").forEach((form) => {
    const field = form.querySelector("textarea");
    const note = form.querySelector("[data-composer-note]");
    form.addEventListener("keydown", (event) => {
      const composing = event.nativeEvent ? event.nativeEvent.isComposing : event.isComposing;
      if (event.key === "Enter" && !event.shiftKey) {
        if (composing || event.keyCode === 229) return; // never submit mid-composition
        event.preventDefault();
        if (typeof form.requestSubmit === "function") form.requestSubmit();
        else form.dispatchEvent(new Event("submit", { cancelable: true }));
      }
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!field.value.trim()) return;
      if (note) {
        note.textContent = "Bounded action queued — signed attempt required.";
        note.classList.add("is-live");
      }
      field.value = "";
    });
  });

  /* ---------------------------------------------------------- scroll pinning demo */
  const stream = document.querySelector("[data-live-stream]");
  if (stream && !reduceMotion) {
    const pin = { active: true, cooldownUntil: 0 };
    stream.addEventListener("scroll", () => {
      const nearBottom = stream.scrollHeight - stream.clientHeight - stream.scrollTop < 40;
      if (!nearBottom) { pin.active = false; pin.cooldownUntil = performance.now() + 150; }
      else if (performance.now() > pin.cooldownUntil) pin.active = true;
    }, { passive: true });

    const samples = [
      ["verify", "Kernel check passed for lemma L3."],
      ["agent", "Searching Mathlib for reusable bound…"],
      ["artifact", "Attached bundle sha256:9be1…07d4"],
      ["agent", "Proposed branch: n ≥ 2 via case split."],
      ["verify", "Axiom audit: no `sorry`, no extra axioms."],
    ];
    let i = 0;
    setInterval(() => {
      const [kind, text] = samples[i % samples.length]; i += 1;
      const li = document.createElement("li");
      const t = new Date().toLocaleTimeString("en-GB", { hour12: false });
      li.innerHTML = `<time>${t}</time><div><strong>${kind}</strong><span>${text}</span></div>`;
      stream.append(li);
      while (stream.children.length > 24) stream.firstElementChild.remove();
      if (pin.active) stream.scrollTop = stream.scrollHeight;
    }, 2600);
  }
})();

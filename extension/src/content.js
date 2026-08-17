(() => {
  const ROOT_ID = "wikipoly-root";
  const SPLIT_ID = "wikipoly-split-root";
  const MSG_SCROLL = "WIKIPOLY_SCROLL";
  const MSG_SCROLL_SET = "WIKIPOLY_SCROLL_SET";

  if (window !== window.top) {
    setupIframeBridge();
    return;
  }

  console.debug("[WikiPoly Bar] content script", location.href);

  let settings = { ...WIKIPOLY_DEFAULTS };
  let langMap = new Map();
  let currentLang = "";
  let articleTitle = "";
  let cssText = "";
  let host = null;
  let shadow = null;
  let splitHost = null;
  let splitShadow = null;
  let splitOpen = false;
  let syncLockUntil = 0;
  let lastHref = location.href;
  let dragging = false;
  let menuOpen = false;

  init().catch((err) => {
    console.warn("[WikiPoly Bar] init failed", err);
  });

  async function init() {
    if (!isArticlePage()) return;
    currentLang = wikipolyHostLang(location.hostname);
    articleTitle = readArticleTitle();
    if (!currentLang || !articleTitle) return;

    const [stored, css] = await Promise.all([
      chrome.storage.sync.get(WIKIPOLY_DEFAULTS),
      loadCss()
    ]);
    settings = { ...WIKIPOLY_DEFAULTS, ...stored };
    cssText = css;
    langMap = collectLangLinks();
    if (!langMap.has(currentLang)) {
      langMap.set(currentLang, location.href.split("#")[0].split("?")[0]);
    }
    await fillMissingLangLinks();
    mount();
    bindEvents();
  }

  function isArticlePage() {
    const body = document.body;
    if (!body || !body.classList.contains("mediawiki")) return false;
    if (body.classList.contains("ns-special")) return false;
    if (body.classList.contains("action-edit")) return false;
    if (!body.classList.contains("ns-0") && !body.classList.contains("ns-subject")) {
      return Boolean(document.querySelector("link[rel='alternate'][hreflang]"));
    }
    return true;
  }

  function readArticleTitle() {
    const path = location.pathname;
    if (path.startsWith("/wiki/")) {
      return decodeURIComponent(path.slice(6).replace(/_/g, " "));
    }
    const fromQuery = new URLSearchParams(location.search).get("title");
    if (fromQuery) return fromQuery.replace(/_/g, " ");
    const heading = document.querySelector("#firstHeading");
    return heading ? heading.textContent.trim() : "";
  }

  function collectLangLinks() {
    const map = new Map();
    document.querySelectorAll("link[rel='alternate'][hreflang]").forEach((link) => {
      const lang = wikipolyNormalizeLang(link.getAttribute("hreflang"));
      const href = link.getAttribute("href");
      if (!lang || !href || lang === "x-default") return;
      map.set(lang, href);
    });
    document.querySelectorAll("a.interlanguage-link-target[hreflang], li.interlanguage-link a").forEach((anchor) => {
      const lang = wikipolyNormalizeLang(anchor.getAttribute("hreflang") || anchor.getAttribute("lang"));
      const href = anchor.href;
      if (lang && href) map.set(lang, href);
    });
    return map;
  }

  async function fillMissingLangLinks() {
    const needed = (settings.languages || []).filter((code) => !langMap.has(code));
    if (!needed.length) return;
    const endpoint = `${location.origin}/w/api.php?action=query&format=json&origin=*&prop=langlinks&lllimit=max&titles=${encodeURIComponent(articleTitle)}`;
    try {
      const data = await fetch(endpoint).then((res) => res.json());
      const pages = data?.query?.pages || {};
      const page = Object.values(pages)[0];
      if (!page?.langlinks) return;
      for (const item of page.langlinks) {
        const lang = wikipolyNormalizeLang(item.lang);
        const title = String(item["*"] || "").replace(/ /g, "_");
        if (!lang || !title) continue;
        const isMobile = location.hostname.includes(".m.");
        const host = isMobile ? `${lang}.m.wikipedia.org` : `${lang}.wikipedia.org`;
        langMap.set(lang, `https://${host}/wiki/${encodeURIComponent(title).replace(/%2F/g, "/")}`);
      }
    } catch (err) {
      console.warn("WikiPoly Bar: langlinks fallback failed", err);
    }
  }

  async function loadCss() {
    const url = chrome.runtime.getURL("src/content.css");
    try {
      return await fetch(url).then((res) => res.text());
    } catch (_err) {
      return "";
    }
  }

  function wikiTheme() {
    const html = document.documentElement;
    if (html.classList.contains("skin-theme-clientpref-night")) return "dark";
    if (html.classList.contains("skin-theme-clientpref-day")) return "light";
    if (html.classList.contains("skin-theme-clientpref-os") && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function mount() {
    host = document.getElementById(ROOT_ID);
    if (!host) {
      host = document.createElement("div");
      host.id = ROOT_ID;
      document.documentElement.appendChild(host);
    }
    shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
    render();
  }

  function render() {
    if (!shadow) return;
    host.setAttribute("data-theme", wikiTheme());
    if (!settings.barVisible) {
      shadow.innerHTML = `<style>${cssText}</style>${restoreMarkup()}`;
      bindRestore();
      return;
    }
    shadow.innerHTML = `<style>${cssText}</style>${barMarkup()}`;
    bindBar();
  }

  function restoreMarkup() {
    const placed = hasSavedPosition();
    const hostClass = ["wpb-host", "is-minimized", placed ? "is-placed" : "is-centered"].join(" ");
    return `
      <div class="${hostClass}" part="bar">
        <button type="button" class="wpb-restore" data-action="restore" title="Show WikiPoly Bar">
          ${brandMark()}
        </button>
      </div>
    `;
  }

  function bindRestore() {
    const shell = shadow.querySelector(".wpb-host");
    if (!shell) return;
    applyBarPosition(shell);
    bindDrag(shell);
    const restoreBtn = shadow.querySelector("[data-action='restore']");
    if (restoreBtn) {
      restoreBtn.addEventListener("click", async () => {
        settings.barVisible = true;
        settings.barMinimized = false;
        await chrome.storage.sync.set({ barVisible: true, barMinimized: false });
        render();
      });
    }
  }

  function barMarkup() {
    const minimized = Boolean(settings.barMinimized);
    const placed = hasSavedPosition();
    const hostClass = ["wpb-host", minimized ? "is-minimized" : "", placed ? "is-placed" : "is-centered"]
      .filter(Boolean)
      .join(" ");

    if (minimized) {
      return `
        <div class="${hostClass}" part="bar">
          <div class="wpb-bar wpb-bar-mini" role="navigation" aria-label="WikiPoly Bar minimized">
            <span class="wpb-grip" data-drag title="Drag to move" aria-hidden="true"></span>
            ${brandMark()}
            <span class="wpb-mini-lang">${escapeHtml((currentLang || "W").toUpperCase())}</span>
            ${windowControlsMarkup("minimized")}
          </div>
        </div>
      `;
    }

    const langs = settings.languages || [];
    const buttons = langs
      .map((code, index) => {
        const available = langMap.has(code);
        const current = code === currentLang;
        const meta = WIKIPOLY_LANGUAGES[code];
        const label = meta ? meta.native : code;
        const title = available
          ? (current ? `${label} — current edition` : `Open ${label} edition`)
          : `No ${label} edition for this article`;
        const cls = ["wpb-lang", current ? "is-current" : "", available ? "" : "is-missing"].filter(Boolean).join(" ");
        return `<button type="button" class="${cls}" data-lang="${code}" data-index="${index}" title="${escapeHtml(title)}" ${available ? "" : "disabled"}>
          ${code.toUpperCase()}<kbd>${index + 1}</kbd>
        </button>`;
      })
      .join("");

    const splitReady = langs.filter((code) => langMap.has(code)).length >= 2;

    return `
      <div class="${hostClass}" part="bar">
        <nav class="wpb-bar" role="navigation" aria-label="WikiPoly language switcher">
          <span class="wpb-grip" data-drag title="Drag to move" aria-hidden="true"></span>
          <div class="wpb-brand" data-drag title="Drag to move">
            ${brandMark()}
            <span>WikiPoly</span>
          </div>
          <div class="wpb-langs">${buttons}</div>
          <div class="wpb-actions">
            <button type="button" class="wpb-split" data-action="split" ${splitReady ? "" : "disabled"} title="Compare two editions in this tab (Alt+Shift+S)">
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M1 2h6v12H1zm8 0h6v12H9z"/></svg>
              <span>Split view</span>
            </button>
            <button type="button" class="wpb-iconbtn" data-action="settings" title="Settings" aria-haspopup="true" aria-expanded="${menuOpen ? "true" : "false"}">
              ${gearMark()}
            </button>
            ${windowControlsMarkup("expanded")}
          </div>
        </nav>
        ${settingsMenuMarkup()}
      </div>
    `;
  }

  function bindBar() {
    const shell = shadow.querySelector(".wpb-host");
    if (!shell) return;
    applyBarPosition(shell);
    bindDrag(shell);

    shadow.querySelectorAll(".wpb-lang").forEach((button) => {
      button.addEventListener("click", () => switchToLang(button.dataset.lang));
    });
    const splitBtn = shadow.querySelector("[data-action='split']");
    if (splitBtn) splitBtn.addEventListener("click", () => toggleSplit());
    const minimizeBtn = shadow.querySelector("[data-action='minimize']");
    if (minimizeBtn) {
      minimizeBtn.addEventListener("click", () => setMinimized(true));
    }
    const expandBtn = shadow.querySelector("[data-action='expand']");
    if (expandBtn) {
      expandBtn.addEventListener("click", () => setMinimized(false));
    }
    const closeBtn = shadow.querySelector("[data-action='close']");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => closeBar());
    }
    const settingsBtn = shadow.querySelector("[data-action='settings']");
    if (settingsBtn) {
      settingsBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleMenu();
      });
    }
    bindSettingsMenu();
    if (menuOpen) showMenu();
  }

  function settingsMenuMarkup() {
    const langs = settings.languages || [];
    const rows = langs
      .map((code, index) => {
        const meta = WIKIPOLY_LANGUAGES[code];
        const native = meta ? meta.native : code;
        return `<div class="wpb-menu-row" data-code="${code}">
          <span class="wpb-menu-badge">${code.toUpperCase()}</span>
          <span class="wpb-menu-name">${escapeHtml(native)}<small>Alt+${index + 1}</small></span>
          <button type="button" class="wpb-iconbtn" data-move="up" ${index === 0 ? "disabled" : ""} title="Move up">↑</button>
          <button type="button" class="wpb-iconbtn" data-move="down" ${index === langs.length - 1 ? "disabled" : ""} title="Move down">↓</button>
          <button type="button" class="wpb-iconbtn" data-remove title="Remove">✕</button>
        </div>`;
      })
      .join("");
    const remaining = Object.keys(WIKIPOLY_LANGUAGES).filter((code) => !langs.includes(code));
    const options = remaining
      .map((code) => `<option value="${code}">${escapeHtml(WIKIPOLY_LANGUAGES[code].native)} (${code})</option>`)
      .join("");
    return `
      <div class="wpb-menu" hidden>
        <div class="wpb-menu-title">Preferences</div>
        <div class="wpb-menu-label">Preferred languages</div>
        <div class="wpb-menu-list">${rows}</div>
        <div class="wpb-menu-add">
          <select class="wpb-menu-select" aria-label="Add a language">${options}</select>
          <button type="button" class="wpb-menu-addbtn" data-add ${remaining.length ? "" : "disabled"}>Add</button>
        </div>
        <label class="wpb-menu-check">
          <input type="checkbox" data-pref="shortcutsEnabled" ${settings.shortcutsEnabled ? "checked" : ""}>
          Keyboard shortcuts
        </label>
        <label class="wpb-menu-check">
          <input type="checkbox" data-pref="syncScroll" ${settings.syncScroll ? "checked" : ""}>
          Sync split-view scroll
        </label>
      </div>
    `;
  }

  function bindSettingsMenu() {
    const menu = shadow.querySelector(".wpb-menu");
    if (!menu) return;
    menu.addEventListener("pointerdown", (event) => event.stopPropagation());
    menu.querySelectorAll(".wpb-menu-row").forEach((row, index) => {
      row.querySelector("[data-move='up']")?.addEventListener("click", () => moveLanguage(index, -1));
      row.querySelector("[data-move='down']")?.addEventListener("click", () => moveLanguage(index, 1));
      row.querySelector("[data-remove]")?.addEventListener("click", () => removeLanguage(index));
    });
    const addBtn = menu.querySelector("[data-add]");
    const addSelect = menu.querySelector(".wpb-menu-select");
    if (addBtn && addSelect) {
      addBtn.addEventListener("click", () => addLanguage(addSelect.value));
    }
    menu.querySelectorAll("input[data-pref]").forEach((input) => {
      input.addEventListener("change", async () => {
        const key = input.dataset.pref;
        settings[key] = input.checked;
        await chrome.storage.sync.set({ [key]: input.checked });
      });
    });
  }

  function toggleMenu() {
    if (menuOpen) closeMenu();
    else showMenu();
  }

  function showMenu() {
    const menu = shadow.querySelector(".wpb-menu");
    const button = shadow.querySelector("[data-action='settings']");
    const shell = shadow.querySelector(".wpb-host");
    if (!menu || !shell) return;
    menuOpen = true;
    menu.hidden = false;
    if (button) button.setAttribute("aria-expanded", "true");
    const bar = shell.querySelector(".wpb-bar");
    const barRect = bar.getBoundingClientRect();
    const spaceBelow = window.innerHeight - barRect.bottom;
    menu.classList.toggle("is-above", spaceBelow < 280 && barRect.top > spaceBelow);
  }

  function closeMenu() {
    menuOpen = false;
    const menu = shadow.querySelector(".wpb-menu");
    const button = shadow.querySelector("[data-action='settings']");
    if (menu) menu.hidden = true;
    if (button) button.setAttribute("aria-expanded", "false");
  }

  async function persistLanguages(next) {
    if (!next.length) return;
    menuOpen = true;
    settings.languages = next;
    await chrome.storage.sync.set({ languages: next });
    await fillMissingLangLinks();
    render();
  }

  function moveLanguage(index, delta) {
    const next = (settings.languages || []).slice();
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    persistLanguages(next);
  }

  function removeLanguage(index) {
    const next = (settings.languages || []).filter((_, i) => i !== index);
    persistLanguages(next);
  }

  function addLanguage(code) {
    if (!code || (settings.languages || []).includes(code)) return;
    persistLanguages((settings.languages || []).concat(code));
  }

  function hasSavedPosition() {
    const pos = settings.barPosition;
    return Boolean(pos && Number.isFinite(pos.x) && Number.isFinite(pos.y));
  }

  function applyBarPosition(el) {
    if (!hasSavedPosition()) return;
    const pos = clampPosition(el, settings.barPosition.x, settings.barPosition.y);
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
    el.style.right = "auto";
    el.style.transform = "none";
    el.classList.add("is-placed");
    el.classList.remove("is-centered");
  }

  function clampPosition(el, x, y) {
    const width = el.offsetWidth || 240;
    const height = el.offsetHeight || 40;
    const maxX = Math.max(8, window.innerWidth - width - 8);
    const maxY = Math.max(8, window.innerHeight - height - 8);
    return {
      x: Math.min(Math.max(8, x), maxX),
      y: Math.min(Math.max(8, y), maxY)
    };
  }

  function bindDrag(el) {
    let startX = 0;
    let startY = 0;
    let origX = 0;
    let origY = 0;
    let moved = false;

    const onMove = (event) => {
      if (!dragging) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      const next = clampPosition(el, origX + dx, origY + dy);
      el.style.left = `${next.x}px`;
      el.style.top = `${next.y}px`;
      el.style.right = "auto";
      el.style.transform = "none";
      el.classList.add("is-placed", "is-dragging");
      el.classList.remove("is-centered");
    };

    const onUp = async (event) => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove("is-dragging");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (!moved) return;
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const next = clampPosition(el, rect.left, rect.top);
      settings.barPosition = { x: Math.round(next.x), y: Math.round(next.y) };
      await chrome.storage.sync.set({ barPosition: settings.barPosition });
    };

    el.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const origin = event.target.closest("[data-drag], .wpb-grip, .wpb-brand, .wpb-bar-mini");
      if (!origin) return;
      if (event.target.closest("button, a, select, input")) return;
      const rect = el.getBoundingClientRect();
      dragging = true;
      moved = false;
      startX = event.clientX;
      startY = event.clientY;
      origX = rect.left;
      origY = rect.top;
      el.classList.add("is-dragging");
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp, { once: true });
    });
  }

  async function setMinimized(next) {
    menuOpen = false;
    settings.barMinimized = Boolean(next);
    await chrome.storage.sync.set({ barMinimized: settings.barMinimized });
    render();
  }

  async function closeBar() {
    menuOpen = false;
    settings.barVisible = false;
    await chrome.storage.sync.set({ barVisible: false });
    render();
  }

  function windowControlsMarkup(mode) {
    const top = mode === "minimized"
      ? `<button type="button" class="wpb-winbtn" data-action="expand" title="Expand bar">${expandIcon()}</button>`
      : `<button type="button" class="wpb-winbtn" data-action="minimize" title="Minimize bar">${minimizeIcon()}</button>`;
    return `<div class="wpb-winbtns">
      ${top}
      <button type="button" class="wpb-winbtn wpb-winbtn-close" data-action="close" title="Close bar">${closeIcon()}</button>
    </div>`;
  }

  function minimizeIcon() {
    return `<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="1" y="4.4" width="8" height="1.2" rx="0.6" fill="currentColor"/></svg>`;
  }

  function expandIcon() {
    return `<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" d="M2.2 5.8V2.2H5.8M7.8 4.2v3.6H4.2"/></svg>`;
  }

  function closeIcon() {
    return `<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2.2 2.2l5.6 5.6M7.8 2.2L2.2 7.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;
  }

  function switchToLang(code) {
    if (!code || code === currentLang) return;
    const url = langMap.get(code);
    if (!url) return;
    location.assign(url);
  }

  function switchToIndex(index) {
    const code = (settings.languages || [])[index];
    if (code) switchToLang(code);
  }

  function toggleSplit() {
    if (splitOpen) {
      closeSplit();
      return;
    }
    const available = (settings.languages || []).filter((code) => langMap.has(code));
    if (available.length < 2) return;
    const left = currentLang;
    const right = available.find((code) => code !== currentLang) || available[1];
    openSplit(left, right);
  }

  function openSplit(leftLang, rightLang) {
    splitOpen = true;
    host?.classList.add("wpb-split-active");
    ensureSplitHost();
    splitHost.setAttribute("data-theme", wikiTheme());
    splitHost.classList.add("wpb-overlay");
    splitHost.style.cssText = [
      "position:fixed",
      "top:0",
      "left:0",
      "right:0",
      "bottom:0",
      "width:100vw",
      "height:100vh",
      "max-width:none",
      "max-height:none",
      "margin:0",
      "padding:0",
      "border:none",
      "z-index:2147483646",
      "display:block",
      "background:#ffffff"
    ].join(";");

    splitShadow.innerHTML = `
      <style>${cssText}</style>
      <div class="split" role="dialog" aria-label="Wikipedia split view">
        <div class="split-toolbar">
          <strong>Split view</strong>
          ${langSelect("left", leftLang)}
          <span class="split-vs">vs</span>
          ${langSelect("right", rightLang)}
          <label class="split-check">
            <input type="checkbox" data-sync ${settings.syncScroll ? "checked" : ""}>
            Sync scroll
          </label>
          <span class="split-grow"></span>
          <button type="button" class="split-close" data-close>Close</button>
        </div>
        <div class="split-panes">
          <div class="split-col" data-col="left">
            <div class="split-loading">Loading ${escapeHtml((leftLang || "").toUpperCase())}…</div>
            <iframe class="split-pane" data-pane="left" title="Left edition" src="${escapeAttr(frameUrl(leftLang))}"></iframe>
          </div>
          <div class="split-gutter" aria-hidden="true"></div>
          <div class="split-col" data-col="right">
            <div class="split-loading">Loading ${escapeHtml((rightLang || "").toUpperCase())}…</div>
            <iframe class="split-pane" data-pane="right" title="Right edition" src="${escapeAttr(frameUrl(rightLang))}"></iframe>
          </div>
        </div>
      </div>
    `;

    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    splitShadow.querySelector("[data-close]").addEventListener("click", closeSplit);
    splitShadow.querySelector("[data-sync]").addEventListener("change", async (event) => {
      settings.syncScroll = event.target.checked;
      await chrome.storage.sync.set({ syncScroll: settings.syncScroll });
    });
    splitShadow.querySelectorAll("select").forEach((select) => {
      select.addEventListener("change", () => {
        const col = splitShadow.querySelector(`[data-col='${select.dataset.side}']`);
        const pane = col.querySelector("iframe");
        col.classList.remove("is-ready");
        pane.src = frameUrl(select.value);
      });
    });
    splitShadow.querySelectorAll("iframe.split-pane").forEach((frame) => {
      frame.addEventListener("load", () => {
        frame.parentElement.classList.add("is-ready");
      });
    });
  }

  function ensureSplitHost() {
    splitHost = document.getElementById(SPLIT_ID);
    if (!splitHost) {
      splitHost = document.createElement("div");
      splitHost.id = SPLIT_ID;
      document.documentElement.appendChild(splitHost);
    }
    splitShadow = splitHost.shadowRoot || splitHost.attachShadow({ mode: "open" });
  }

  function langSelect(side, selected) {
    const options = (settings.languages || [])
      .filter((code) => langMap.has(code))
      .map((code) => {
        const meta = WIKIPOLY_LANGUAGES[code];
        const label = meta ? `${code.toUpperCase()} — ${meta.native}` : code.toUpperCase();
        return `<option value="${code}" ${code === selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
      })
      .join("");
    return `<select class="split-select" data-side="${side}" aria-label="${side} language">${options}</select>`;
  }

  function frameUrl(code) {
    const url = new URL(langMap.get(code));
    url.searchParams.set("wikipoly_split", "1");
    return url.toString();
  }

  function closeSplit() {
    splitOpen = false;
    host?.classList.remove("wpb-split-active");
    if (splitHost) {
      splitHost.remove();
      splitHost = null;
      splitShadow = null;
    }
    document.documentElement.style.overflow = "";
    document.body.style.overflow = "";
  }

  function bindEvents() {
    document.addEventListener("keydown", onKeydown, true);
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type !== "wikipoly-command") return;
      handleCommand(message.command);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      for (const [key, value] of Object.entries(changes)) {
        settings[key] = value.newValue;
      }
      if (dragging || splitOpen) return;
      if (Object.keys(changes).length === 1 && changes.barPosition) {
        const shell = shadow?.querySelector(".wpb-host");
        if (shell) applyBarPosition(shell);
        return;
      }
      render();
    });
    window.addEventListener("resize", () => {
      const shell = shadow?.querySelector(".wpb-host");
      if (shell && hasSavedPosition()) applyBarPosition(shell);
    });
    window.addEventListener("pointerdown", (event) => {
      if (!menuOpen || dragging) return;
      const path = event.composedPath();
      if (path.some((node) => node.classList && (node.classList.contains("wpb-menu") || node.matches?.("[data-action='settings']")))) {
        return;
      }
      closeMenu();
    }, true);
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (!splitOpen) render();
    });
    setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        location.reload();
      }
    }, 1500);
  }

  function onKeydown(event) {
    if (event.key === "Escape" && splitOpen) {
      event.preventDefault();
      closeSplit();
      return;
    }
    if (!settings.shortcutsEnabled) return;
    const target = event.target;
    if (target && target.closest && target.closest("input, textarea, select, [contenteditable='true']")) return;

    const digit = event.code.match(/^Digit([1-9])$/);
    const withAlt = event.altKey && !event.ctrlKey && !event.metaKey;
    if (withAlt && digit) {
      event.preventDefault();
      event.stopPropagation();
      switchToIndex(Number(digit[1]) - 1);
      return;
    }
    if (withAlt && event.shiftKey && event.code === "KeyS") {
      event.preventDefault();
      toggleSplit();
    }
  }

  function handleCommand(command) {
    if (command === "toggle-split") {
      toggleSplit();
      return;
    }
    const match = String(command).match(/^switch-lang-(\d)$/);
    if (match) switchToIndex(Number(match[1]) - 1);
  }

  function onFrameMessage(event) {
    if (!splitOpen || !settings.syncScroll) return;
    const data = event.data;
    if (!data || data.source !== "wikipoly" || data.type !== MSG_SCROLL) return;
    if (Date.now() < syncLockUntil) return;
    const wrap = splitShadow;
    if (!wrap) return;
    const left = wrap.querySelector("iframe[data-pane='left']");
    const right = wrap.querySelector("iframe[data-pane='right']");
    const other = event.source === left.contentWindow ? right : event.source === right.contentWindow ? left : null;
    if (!other?.contentWindow) return;
    syncLockUntil = Date.now() + 80;
    other.contentWindow.postMessage(
      { source: "wikipoly", type: MSG_SCROLL_SET, ratio: data.ratio },
      "*"
    );
  }

  function setupIframeBridge() {
    const params = new URLSearchParams(location.search);
    if (params.get("wikipoly_split") !== "1") return;

    let ticking = false;
    window.addEventListener(
      "scroll",
      () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          ticking = false;
          const max = document.documentElement.scrollHeight - innerHeight;
          const ratio = max > 0 ? scrollY / max : 0;
          parent.postMessage({ source: "wikipoly", type: MSG_SCROLL, ratio }, "*");
        });
      },
      { passive: true }
    );

    window.addEventListener("message", (event) => {
      const data = event.data;
      if (!data || data.source !== "wikipoly" || data.type !== MSG_SCROLL_SET) return;
      const max = document.documentElement.scrollHeight - innerHeight;
      scrollTo({ top: max * Number(data.ratio || 0), behavior: "auto" });
    });
  }

  function brandMark() {
    return `<svg class="wpb-mark" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect width="16" height="16" rx="3.5" fill="#1B3A6B"/>
      <text x="8" y="11.2" text-anchor="middle" font-size="9" font-weight="700" font-family="system-ui,Segoe UI,sans-serif" fill="#fff">W</text>
    </svg>`;
  }

  function gearMark() {
    return `<svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 00.12-.64l-1.92-3.32a.5.5 0 00-.6-.22l-2.39.96a7.03 7.03 0 00-1.63-.94l-.36-2.54A.5.5 0 0013.9 1h-3.8a.5.5 0 00-.5.42l-.36 2.54c-.59.24-1.13.55-1.63.94l-2.39-.96a.5.5 0 00-.6.22L2.8 8.48a.5.5 0 00.12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.92 14.1a.5.5 0 00-.12.64l1.92 3.32c.12.22.37.3.6.22l2.39-.96c.5.39 1.04.7 1.63.94l.36 2.54c.05.24.26.42.5.42h3.8c.24 0 .45-.18.5-.42l.36-2.54c.59-.24 1.13-.55 1.63-.94l2.39.96c.23.08.48 0 .6-.22l1.92-3.32a.5.5 0 00-.12-.64l-2.03-1.58zM12 15.6A3.6 3.6 0 1112 8.4a3.6 3.6 0 010 7.2z"/>
    </svg>`;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }
})();

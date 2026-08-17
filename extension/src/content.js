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
      shadow.innerHTML = "";
      host.removeAttribute("class");
      return;
    }
    shadow.innerHTML = `<style>${cssText}</style>${barMarkup()}`;
    bindBar();
  }

  function barMarkup() {
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
      <div class="wpb-host" part="bar">
        <nav class="wpb-bar" role="navigation" aria-label="WikiPoly language switcher">
          <div class="wpb-brand" title="WikiPoly Bar">
            ${brandMark()}
            <span>WikiPoly</span>
          </div>
          <div class="wpb-langs">${buttons}</div>
          <div class="wpb-actions">
            <button type="button" class="wpb-split" data-action="split" ${splitReady ? "" : "disabled"} title="Compare two editions in this tab (Alt+Shift+S)">
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M1 2h6v12H1zm8 0h6v12H9z"/></svg>
              <span>Split view</span>
            </button>
            <button type="button" class="wpb-iconbtn" data-action="hide" title="Hide bar">✕</button>
          </div>
        </nav>
      </div>
    `;
  }

  function bindBar() {
    shadow.querySelectorAll(".wpb-lang").forEach((button) => {
      button.addEventListener("click", () => switchToLang(button.dataset.lang));
    });
    const splitBtn = shadow.querySelector("[data-action='split']");
    if (splitBtn) splitBtn.addEventListener("click", () => toggleSplit());
    const hideBtn = shadow.querySelector("[data-action='hide']");
    if (hideBtn) {
      hideBtn.addEventListener("click", async () => {
        settings.barVisible = false;
        await chrome.storage.sync.set({ barVisible: false });
        render();
        showFab();
      });
    }
  }

  function showFab() {
    shadow.innerHTML = `<style>${cssText}</style>
      <div class="wpb-host wpb-collapsed">
        <button type="button" class="wpb-fab" title="Show WikiPoly Bar">
          ${brandMark()}
          WikiPoly
        </button>
      </div>`;
    shadow.querySelector(".wpb-fab").addEventListener("click", async () => {
      settings.barVisible = true;
      await chrome.storage.sync.set({ barVisible: true });
      render();
    });
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
      if (!splitOpen) render();
    });
    window.addEventListener("message", onFrameMessage);
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

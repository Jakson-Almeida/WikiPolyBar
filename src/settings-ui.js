async function wikipolyLoadSettings() {
  const stored = await chrome.storage.sync.get(WIKIPOLY_DEFAULTS);
  const languages = Array.isArray(stored.languages) && stored.languages.length
    ? stored.languages.filter((code) => WIKIPOLY_LANGUAGES[code])
    : wikipolyDetectBrowserLanguages();
  return { ...WIKIPOLY_DEFAULTS, ...stored, languages };
}

async function wikipolySaveSettings(patch) {
  await chrome.storage.sync.set(patch);
}

function wikipolyBindSettingsPage() {
  const list = document.getElementById("lang-list");
  const addSelect = document.getElementById("add-lang");
  const addBtn = document.getElementById("add-btn");
  const barVisible = document.getElementById("bar-visible");
  const shortcuts = document.getElementById("shortcuts");
  const syncScroll = document.getElementById("sync-scroll");

  let settings = null;

  async function refresh() {
    settings = await wikipolyLoadSettings();
    renderLangs();
    fillAddSelect();
    barVisible.checked = settings.barVisible;
    shortcuts.checked = settings.shortcutsEnabled;
    syncScroll.checked = settings.syncScroll;
  }

  function renderLangs() {
    list.innerHTML = "";
    settings.languages.forEach((code, index) => {
      const meta = WIKIPOLY_LANGUAGES[code];
      const row = document.createElement("div");
      row.className = "lang";
      row.innerHTML = `
        <span class="badge">${code.toUpperCase()}</span>
        <div class="lang-name">
          <div>${meta ? meta.native : code}</div>
          <div class="shortcut">Shortcut ${index + 1} · ${meta ? meta.name : ""}</div>
        </div>
        <button type="button" class="icon-btn" data-move="up" ${index === 0 ? "disabled" : ""} title="Move up">↑</button>
        <button type="button" class="icon-btn" data-move="down" ${index === settings.languages.length - 1 ? "disabled" : ""} title="Move down">↓</button>
        <button type="button" class="icon-btn danger" data-remove title="Remove">✕</button>
      `;
      row.querySelector("[data-move='up']").addEventListener("click", () => move(index, -1));
      row.querySelector("[data-move='down']").addEventListener("click", () => move(index, 1));
      row.querySelector("[data-remove]").addEventListener("click", () => remove(index));
      list.appendChild(row);
    });
  }

  function fillAddSelect() {
    const remaining = Object.keys(WIKIPOLY_LANGUAGES).filter((code) => !settings.languages.includes(code));
    addSelect.innerHTML = remaining
      .map((code) => `<option value="${code}">${WIKIPOLY_LANGUAGES[code].native} (${code})</option>`)
      .join("");
    addBtn.disabled = remaining.length === 0;
  }

  async function persistLangs(next) {
    settings.languages = next;
    await wikipolySaveSettings({ languages: next });
    renderLangs();
    fillAddSelect();
  }

  async function move(index, delta) {
    const next = settings.languages.slice();
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    await persistLangs(next);
  }

  async function remove(index) {
    if (settings.languages.length <= 1) return;
    const next = settings.languages.filter((_, i) => i !== index);
    await persistLangs(next);
  }

  addBtn.addEventListener("click", async () => {
    const code = addSelect.value;
    if (!code || settings.languages.includes(code)) return;
    await persistLangs(settings.languages.concat(code));
  });

  barVisible.addEventListener("change", () => wikipolySaveSettings({ barVisible: barVisible.checked }));
  shortcuts.addEventListener("change", () => wikipolySaveSettings({ shortcutsEnabled: shortcuts.checked }));
  syncScroll.addEventListener("change", () => wikipolySaveSettings({ syncScroll: syncScroll.checked }));

  refresh();
}

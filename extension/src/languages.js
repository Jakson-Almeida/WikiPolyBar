/* Shared Wikipedia language catalog and defaults. Loaded before other scripts. */

const WIKIPOLY_LANGUAGES = {
  ar: { name: "Arabic", native: "العربية" },
  bg: { name: "Bulgarian", native: "Български" },
  bn: { name: "Bengali", native: "বাংলা" },
  ca: { name: "Catalan", native: "Català" },
  cs: { name: "Czech", native: "Čeština" },
  da: { name: "Danish", native: "Dansk" },
  de: { name: "German", native: "Deutsch" },
  el: { name: "Greek", native: "Ελληνικά" },
  en: { name: "English", native: "English" },
  eo: { name: "Esperanto", native: "Esperanto" },
  es: { name: "Spanish", native: "Español" },
  et: { name: "Estonian", native: "Eesti" },
  eu: { name: "Basque", native: "Euskara" },
  fa: { name: "Persian", native: "فارسی" },
  fi: { name: "Finnish", native: "Suomi" },
  fr: { name: "French", native: "Français" },
  gl: { name: "Galician", native: "Galego" },
  he: { name: "Hebrew", native: "עברית" },
  hi: { name: "Hindi", native: "हिन्दी" },
  hr: { name: "Croatian", native: "Hrvatski" },
  hu: { name: "Hungarian", native: "Magyar" },
  id: { name: "Indonesian", native: "Bahasa Indonesia" },
  it: { name: "Italian", native: "Italiano" },
  ja: { name: "Japanese", native: "日本語" },
  ko: { name: "Korean", native: "한국어" },
  lt: { name: "Lithuanian", native: "Lietuvių" },
  lv: { name: "Latvian", native: "Latviešu" },
  ms: { name: "Malay", native: "Bahasa Melayu" },
  nl: { name: "Dutch", native: "Nederlands" },
  no: { name: "Norwegian", native: "Norsk" },
  pl: { name: "Polish", native: "Polski" },
  pt: { name: "Portuguese", native: "Português" },
  ro: { name: "Romanian", native: "Română" },
  ru: { name: "Russian", native: "Русский" },
  simple: { name: "Simple English", native: "Simple English" },
  sk: { name: "Slovak", native: "Slovenčina" },
  sl: { name: "Slovenian", native: "Slovenščina" },
  sr: { name: "Serbian", native: "Српски" },
  sv: { name: "Swedish", native: "Svenska" },
  th: { name: "Thai", native: "ไทย" },
  tr: { name: "Turkish", native: "Türkçe" },
  uk: { name: "Ukrainian", native: "Українська" },
  vi: { name: "Vietnamese", native: "Tiếng Việt" },
  zh: { name: "Chinese", native: "中文" }
};

const WIKIPOLY_DEFAULTS = {
  languages: ["pt", "en", "es"],
  barVisible: true,
  barMinimized: false,
  barPosition: null,
  shortcutsEnabled: true,
  syncScroll: false
};

function wikipolyNormalizeLang(code) {
  if (!code) return "";
  const raw = String(code).trim().replace("_", "-").toLowerCase();
  if (raw === "nb" || raw === "nn") return "no";
  if (raw === "zh-cn" || raw === "zh-sg" || raw === "zh-hans") return "zh";
  if (raw === "zh-tw" || raw === "zh-hk" || raw === "zh-hant") return "zh";
  if (raw === "pt-br" || raw === "pt-pt") return "pt";
  if (raw === "en-us" || raw === "en-gb") return "en";
  const base = raw.split("-")[0];
  if (WIKIPOLY_LANGUAGES[raw]) return raw;
  if (WIKIPOLY_LANGUAGES[base]) return base;
  return base;
}

function wikipolyDetectBrowserLanguages() {
  const seen = [];
  const candidates = [];
  try {
    candidates.push(chrome.i18n.getUILanguage());
  } catch (_err) {
    /* ignore */
  }
  if (typeof navigator !== "undefined") {
    if (Array.isArray(navigator.languages)) candidates.push(...navigator.languages);
    if (navigator.language) candidates.push(navigator.language);
  }
  for (const item of candidates) {
    const code = wikipolyNormalizeLang(item);
    if (code && WIKIPOLY_LANGUAGES[code] && !seen.includes(code)) seen.push(code);
  }
  if (!seen.includes("en")) seen.push("en");
  for (const fallback of ["pt", "en", "es"]) {
    if (!seen.includes(fallback)) seen.push(fallback);
  }
  return seen.slice(0, 5);
}

function wikipolyLabel(code) {
  const meta = WIKIPOLY_LANGUAGES[code];
  if (!meta) return code.toUpperCase();
  return `${meta.native} (${code})`;
}

function wikipolyHostLang(hostname) {
  const host = hostname.replace(/^www\./, "");
  const parts = host.split(".");
  if (parts.length < 3 || parts.slice(-2).join(".") !== "wikipedia.org") return "";
  const sub = parts[0] === "m" ? "" : parts[0];
  return wikipolyNormalizeLang(sub);
}

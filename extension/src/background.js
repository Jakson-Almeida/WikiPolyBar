importScripts("languages.js");

const FRAME_RULE_ID = 1;

const FRAME_RULE = {
  id: FRAME_RULE_ID,
  priority: 1,
  action: {
    type: "modifyHeaders",
    responseHeaders: [
      { header: "X-Frame-Options", operation: "remove" },
      { header: "Content-Security-Policy", operation: "remove" },
      { header: "Content-Security-Policy-Report-Only", operation: "remove" }
    ]
  },
  condition: {
    urlFilter: "||wikipedia.org",
    resourceTypes: ["sub_frame"]
  }
};

async function applyFrameRules() {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [FRAME_RULE_ID],
      addRules: [FRAME_RULE]
    });
  } catch (err) {
    console.warn("WikiPoly Bar: could not install frame rules", err);
  }
}

async function ensureDefaults() {
  const stored = await chrome.storage.sync.get(null);
  const patch = {};
  if (!Array.isArray(stored.languages) || stored.languages.length === 0) {
    patch.languages = wikipolyDetectBrowserLanguages();
  }
  if (typeof stored.barVisible !== "boolean") patch.barVisible = true;
  if (typeof stored.shortcutsEnabled !== "boolean") patch.shortcutsEnabled = true;
  if (typeof stored.syncScroll !== "boolean") patch.syncScroll = true;
  if (Object.keys(patch).length) await chrome.storage.sync.set(patch);
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaults();
  await applyFrameRules();
});

chrome.runtime.onStartup.addListener(async () => {
  await applyFrameRules();
});

applyFrameRules();

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "wikipoly-command", command });
  } catch (_err) {
    /* Tab is not a Wikipedia article. */
  }
});

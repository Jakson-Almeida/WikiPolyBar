/**
 * Load the unpacked extension in Chrome via CDP and confirm the bar injects.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = process.env.CDP_PORT || "9333";
const ARTICLE = "https://en.wikipedia.org/wiki/Python_(programming_language)";

function fail(message) {
  throw new Error(message);
}

async function waitFor(fn, timeoutMs, label) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      await delay(300);
    }
  }
  fail(`${label}: ${lastError?.message || "timed out"}`);
}

async function cdp(ws, method, params = {}, sessionId) {
  const id = cdp.nextId++;
  const payload = { id, method, params };
  if (sessionId) payload.sessionId = sessionId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`CDP timeout for ${method}`)), 25000);
    const onMessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener("message", onMessage);
      if (data.error) reject(new Error(`${method}: ${JSON.stringify(data.error)}`));
      else resolve(data.result || {});
    };
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify(payload));
  });
}
cdp.nextId = 1;

async function evaluate(ws, sessionId, expression) {
  const result = await cdp(
    ws,
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    sessionId
  );
  if (result.exceptionDetails) {
    fail(result.exceptionDetails.text || "evaluate failed");
  }
  return result.result?.value;
}

const profile = mkdtempSync(join(tmpdir(), "wikipoly-chrome-"));
const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${PORT}`,
    "--remote-allow-origins=*",
    `--user-data-dir=${profile}`,
    "--enable-unsafe-extension-debugging",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-popup-blocking",
    "about:blank"
  ],
  { stdio: "ignore" }
);

let ws;
try {
  const version = await waitFor(async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    return res.json();
  }, 15000, "CDP endpoint");

  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("WebSocket error")), { once: true });
  });

  const loaded = await cdp(ws, "Extensions.loadUnpacked", { path: ROOT });
  if (!loaded.id) fail(`extension did not load: ${JSON.stringify(loaded)}`);
  console.log(`OK extension id ${loaded.id}`);

  const targets = await cdp(ws, "Target.getTargets");
  const page = (targets.targetInfos || []).find((info) => info.type === "page");
  if (!page) fail("no page target");

  const attached = await cdp(ws, "Target.attachToTarget", { targetId: page.targetId, flatten: true });
  const sessionId = attached.sessionId;
  await cdp(ws, "Page.enable", {}, sessionId);
  await cdp(ws, "Runtime.enable", {}, sessionId);
  await cdp(ws, "Page.navigate", { url: ARTICLE }, sessionId);
  await waitFor(async () => {
    const href = await evaluate(ws, sessionId, "location.href");
    if (!String(href).includes("wikipedia.org")) throw new Error(href);
    const ready = await evaluate(ws, sessionId, "document.readyState");
    if (ready === "loading") throw new Error(ready);
    return href;
  }, 25000, "Wikipedia navigation");

  const injected = await waitFor(async () => {
    const info = await evaluate(
      ws,
      sessionId,
      `(() => {
        const host = document.getElementById("wikipoly-root");
        const shadow = host && host.shadowRoot;
        const langs = shadow ? [...shadow.querySelectorAll(".wpb-lang")].map((btn) => ({
          lang: btn.dataset.lang,
          missing: btn.classList.contains("is-missing"),
          current: btn.classList.contains("is-current")
        })) : [];
        return {
          href: location.href,
          title: document.title,
          mediawiki: document.body?.classList.contains("mediawiki") || false,
          ns0: document.body?.classList.contains("ns-0") || false,
          hasHost: Boolean(host),
          barText: shadow ? (shadow.querySelector(".wpb-bar")?.innerText || "") : "",
          langs,
          splitDisabled: shadow ? Boolean(shadow.querySelector(".wpb-split")?.disabled) : true
        };
      })()`
    );
    if (!info.mediawiki) throw new Error(`not mediawiki (${info.title})`);
    if (!info.hasHost) throw new Error(`bar host not found on ${info.href}`);
    if (!info.barText.includes("WikiPoly")) throw new Error("bar markup missing");
    return info;
  }, 25000, "content script inject");

  const codes = injected.langs.map((item) => item.lang);
  if (!codes.includes("en") && !codes.includes("pt")) {
    fail(`expected EN or PT buttons, got ${JSON.stringify(injected.langs)}`);
  }
  if (injected.splitDisabled) fail("split view disabled on a multilingual article");

  await evaluate(
    ws,
    sessionId,
    `document.getElementById("wikipoly-root").shadowRoot.querySelector("[data-action='split']").click()`
  );
  await waitFor(async () => {
    const frames = await evaluate(
      ws,
      sessionId,
      `document.getElementById("wikipoly-root").shadowRoot.querySelectorAll("iframe.split-pane").length`
    );
    if (frames !== 2) throw new Error(`iframe count ${frames}`);
    return frames;
  }, 8000, "split view iframes");
  await evaluate(
    ws,
    sessionId,
    `document.getElementById("wikipoly-root").shadowRoot.querySelector("[data-close]").click()`
  );

  await evaluate(
    ws,
    sessionId,
    `document.getElementById("wikipoly-root").shadowRoot.querySelector('.wpb-lang[data-lang="pt"]').click()`
  );
  const switched = await waitFor(async () => {
    const href = await evaluate(ws, sessionId, "location.href");
    if (!String(href).includes("pt.wikipedia.org")) throw new Error(href);
    return href;
  }, 20000, "PT language switch");

  console.log(`OK bar on ${injected.href}`);
  console.log(`OK languages ${injected.langs.map((item) => item.lang + (item.current ? "*" : item.missing ? "-" : "")).join(", ")}`);
  console.log("OK split view opened with two official Wikipedia frames");
  console.log(`OK switched to ${switched}`);
} finally {
  if (ws && ws.readyState === WebSocket.OPEN) ws.close();
  chrome.kill();
  await delay(800);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch (_err) {
    /* Chrome may keep files locked on Windows */
  }
}

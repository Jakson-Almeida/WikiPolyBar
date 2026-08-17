import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(ROOT, "extension");
const OUT = join(ROOT, "store", "screenshots");
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = process.env.CDP_PORT || "9334";
const ARTICLE = "https://en.wikipedia.org/wiki/Python_(programming_language)";
const WIDTH = 1280;
const HEIGHT = 800;

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
  if (result.exceptionDetails) fail(result.exceptionDetails.text || "evaluate failed");
  return result.result?.value;
}

mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "wikipoly-store-"));
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

  await cdp(ws, "Extensions.loadUnpacked", { path: EXT });
  const targets = await cdp(ws, "Target.getTargets");
  const page = (targets.targetInfos || []).find((info) => info.type === "page");
  if (!page) fail("no page target");
  const attached = await cdp(ws, "Target.attachToTarget", { targetId: page.targetId, flatten: true });
  const sessionId = attached.sessionId;
  await cdp(ws, "Page.enable", {}, sessionId);
  await cdp(ws, "Runtime.enable", {}, sessionId);
  try {
    const win = await cdp(ws, "Browser.getWindowForTarget", { targetId: page.targetId });
    await cdp(ws, "Browser.setWindowBounds", {
      windowId: win.windowId,
      bounds: { width: WIDTH, height: HEIGHT + 80, windowState: "normal" }
    });
  } catch (_err) {
    /* ignore */
  }
  await cdp(ws, "Emulation.setDeviceMetricsOverride", {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 1,
    mobile: false
  }, sessionId);

  async function screenshot(name) {
    const shot = await cdp(ws, "Page.captureScreenshot", { format: "png", fromSurface: true }, sessionId);
    const file = join(OUT, name);
    writeFileSync(file, Buffer.from(shot.data, "base64"));
    console.log(`wrote ${file}`);
  }

  await cdp(ws, "Page.navigate", { url: ARTICLE }, sessionId);
  await waitFor(async () => {
    const ready = await evaluate(
      ws,
      sessionId,
      `document.body?.classList.contains("mediawiki") && Boolean(document.getElementById("wikipoly-root")?.shadowRoot?.querySelector(".wpb-bar"))`
    );
    if (!ready) throw new Error("bar not ready");
    return ready;
  }, 25000, "bar");

  await delay(1500);
  await screenshot("01-language-bar.png");

  await evaluate(
    ws,
    sessionId,
    `document.getElementById("wikipoly-root").shadowRoot.querySelector("[data-action='settings']").click()`
  );
  await waitFor(async () => {
    const open = await evaluate(
      ws,
      sessionId,
      `(() => { const m = document.getElementById("wikipoly-root").shadowRoot.querySelector(".wpb-menu"); return Boolean(m) && !m.hidden; })()`
    );
    if (!open) throw new Error("menu closed");
    return open;
  }, 8000, "settings");
  await delay(400);
  await screenshot("02-preferences.png");
  await evaluate(
    ws,
    sessionId,
    `document.getElementById("wikipoly-root").shadowRoot.querySelector("[data-action='settings']").click()`
  );

  await evaluate(
    ws,
    sessionId,
    `document.getElementById("wikipoly-root").shadowRoot.querySelector("[data-action='split']").click()`
  );
  await waitFor(async () => {
    const n = await evaluate(
      ws,
      sessionId,
      `document.getElementById("wikipoly-split-root")?.shadowRoot?.querySelectorAll("iframe.split-pane").length || 0`
    );
    if (n !== 2) throw new Error(`frames ${n}`);
    return n;
  }, 12000, "split");
  await delay(4000);
  await screenshot("03-split-view.png");
} finally {
  if (ws && ws.readyState === WebSocket.OPEN) ws.close();
  chrome.kill();
  await delay(800);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch (_err) {
    /* ignore */
  }
}

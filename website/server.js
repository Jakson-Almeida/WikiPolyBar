import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(__dirname, "dist");
const PORT = Number(process.env.PORT || 3000);

const waitlist = [];

const app = express();
app.use(express.json({ limit: "16kb" }));

app.get("/api/product", (_req, res) => {
  res.json({
    name: "WikiPoly Bar",
    version: "1.0.0",
    plan: "free",
    tagline: "Instant Wikipedia language switching, on wikipedia.org.",
    github: "https://github.com/Jakson-Almeida/WikiPolyBar",
    signature: {
      name: "WikiPoly Signature",
      status: "coming_soon",
      priceHint: "Subscription, when it launches",
      features: [
        "Saved research workspaces across language editions",
        "Section-level missing-content reports",
        "Synced notes beside split view",
        "Priority language packs and keyboard layouts"
      ]
    }
  });
});

app.post("/api/waitlist", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ ok: false, error: "Enter a valid email address." });
    return;
  }
  if (!waitlist.includes(email)) waitlist.push(email);
  res.json({ ok: true, joined: true, count: waitlist.length });
});

if (existsSync(path.join(dist, "index.html"))) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(dist, "index.html"));
  });
} else {
  app.get("/", (_req, res) => {
    res
      .type("html")
      .send(
        "<p>WikiPoly API is running. In development open <a href=\"http://localhost:5173\">http://localhost:5173</a>.</p>"
      );
  });
}

app.listen(PORT, () => {
  console.log(`WikiPoly website listening on http://localhost:${PORT}`);
});

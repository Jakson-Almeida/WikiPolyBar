import { useEffect, useState } from "react";

const FALLBACK = {
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
};

const FEATURES = [
  {
    title: "One-click languages",
    body: "Your preferred editions — Portuguese, English, Spanish, or any others you choose — sit on the article as buttons. If a version exists, you switch instantly."
  },
  {
    title: "Split view in the same tab",
    body: "Open two official Wikipedia pages side by side to compare sections or catch missing data, without leaving wikipedia.org."
  },
  {
    title: "Stays on Wikipedia",
    body: "No Wikiwand-style redirect, no extra ads, no disconnected account. You keep the edition you already signed in to."
  },
  {
    title: "Yours to place",
    body: "Drag the bar, minimize it, or close it. A gear menu lets you add and reorder languages without hunting through Chrome settings."
  }
];

export default function App() {
  const [product, setProduct] = useState(FALLBACK);
  const [email, setEmail] = useState("");
  const [waitlist, setWaitlist] = useState({ status: "idle", message: "" });

  useEffect(() => {
    fetch("/api/product")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(setProduct)
      .catch(() => setProduct(FALLBACK));
  }, []);

  async function joinWaitlist(event) {
    event.preventDefault();
    setWaitlist({ status: "saving", message: "" });
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setWaitlist({ status: "error", message: data.error || "Could not join the list." });
        return;
      }
      setWaitlist({ status: "ok", message: "You are on the Signature list. We will write when it opens." });
      setEmail("");
    } catch (_err) {
      setWaitlist({ status: "error", message: "Network error. Try again in a moment." });
    }
  }

  return (
    <>
      <header className="top">
        <a className="brand" href="#top">
          <img src="/icon.svg" width="32" height="32" alt="" />
          WikiPoly
        </a>
        <nav>
          <a href="#features">Features</a>
          <a href="#install">Install</a>
          <a href="#signature">Signature</a>
          <a className="ghost" href={product.github} rel="noopener noreferrer">
            GitHub
          </a>
        </nav>
      </header>

      <main id="top">
        <section className="hero">
          <p className="eyebrow">Chrome extension · {product.plan === "free" ? "Free" : product.plan}</p>
          <h1>Wikipedia, in the languages you actually use.</h1>
          <p className="lead">{product.tagline}</p>
          <p className="lead-sub">
            Vector 2022 buried the language list in a dropdown. WikiPoly Bar puts PT, EN, ES — and the rest of your
            list — back on the article as one-click buttons and keyboard shortcuts.
          </p>
          <div className="cta">
            <a className="btn primary" href="#install">
              Install for free
            </a>
            <a className="btn" href={product.github} rel="noopener noreferrer">
              View source
            </a>
          </div>
          <div className="preview" aria-hidden="true">
            <div className="fake-bar">
              <span className="grip" />
              <img src="/icon.svg" width="16" height="16" alt="" />
              <strong>WikiPoly</strong>
              <span className="pill on">PT 1</span>
              <span className="pill">EN 2</span>
              <span className="pill">ES 3</span>
              <span className="split">Split view</span>
            </div>
            <p className="caption">Lives on official Wikipedia articles. No third-party reader.</p>
          </div>
        </section>

        <section id="features" className="section">
          <h2>What it does today</h2>
          <div className="features">
            {FEATURES.map((item) => (
              <article key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="install" className="section band">
          <h2>Install in Chrome</h2>
          <ol className="steps">
            <li>
              Open <code>chrome://extensions</code> and turn on Developer mode.
            </li>
            <li>
              Click <strong>Load unpacked</strong> and select the <code>extension</code> folder from the{" "}
              <a href={product.github} rel="noopener noreferrer">
                GitHub repository
              </a>
              .
            </li>
            <li>
              Open any article, for example{" "}
              <a href="https://en.wikipedia.org/wiki/Python_(programming_language)" rel="noopener noreferrer">
                Python (programming language)
              </a>
              .
            </li>
          </ol>
          <p className="fine">
            Shortcuts: Alt+Shift+1… for languages, Alt+Shift+S for split view. Chrome on Windows often steals Alt+1 for
            tabs.
          </p>
        </section>

        <section id="signature" className="section">
          <div className="plans">
            <article className="plan current">
              <p className="plan-tag">Now</p>
              <h2>Free</h2>
              <p className="price">$0</p>
              <p>The core switcher is free. Language buttons, split view, drag, minimize, and the gear menu stay that way.</p>
              <ul>
                <li>Preferred languages on every article</li>
                <li>Same-tab split view of official editions</li>
                <li>Local Chrome sync only — no analytics</li>
              </ul>
            </article>
            <article className="plan signature">
              <p className="plan-tag">Later</p>
              <h2>{product.signature.name}</h2>
              <p className="price">Subscription</p>
              <p>
                Advanced research tools will ship later as <strong>WikiPoly Signature</strong>, a paid subscription.
                Nothing is billed today.
              </p>
              <ul>
                {product.signature.features.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <form className="waitlist" onSubmit={joinWaitlist}>
                <label htmlFor="email">Get a note when Signature opens</label>
                <div className="row">
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                  <button type="submit" className="btn primary" disabled={waitlist.status === "saving"}>
                    {waitlist.status === "saving" ? "Joining…" : "Join waitlist"}
                  </button>
                </div>
                {waitlist.message ? (
                  <p className={waitlist.status === "ok" ? "ok" : "err"}>{waitlist.message}</p>
                ) : null}
              </form>
            </article>
          </div>
        </section>
      </main>

      <footer>
        <p>
          WikiPoly Bar {product.version} · stays on wikipedia.org ·{" "}
          <a href={product.github} rel="noopener noreferrer">
            source on GitHub
          </a>
        </p>
      </footer>
    </>
  );
}

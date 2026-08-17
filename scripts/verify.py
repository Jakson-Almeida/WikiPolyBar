"""Validate the extension package and live Wikipedia language-link parsing."""

from __future__ import annotations

import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARTICLE = "https://en.wikipedia.org/wiki/Python_(programming_language)"
API = (
    "https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*"
    "&prop=langlinks&lllimit=max&titles=Python_(programming_language)"
)
HREFLANG = re.compile(
    r'<a[^>]+class="[^"]*interlanguage-link-target[^"]*"[^>]*>',
    re.I,
)
HREF = re.compile(r'\bhref="([^"]+)"', re.I)
LANG = re.compile(r'\bhreflang="([^"]+)"', re.I)


def fail(message: str) -> None:
    raise SystemExit(f"FAIL: {message}")


def check_manifest() -> None:
    data = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    if data.get("manifest_version") != 3:
        fail("manifest_version must be 3")
    for size in (16, 32, 48, 128):
        icon = ROOT / f"icons/icon{size}.png"
        if not icon.exists():
            fail(f"missing {icon.name}")
    if not (ROOT / "icons/favicon.ico").exists():
        fail("missing favicon.ico")
    required = [
        "src/background.js",
        "src/content.js",
        "src/content.css",
        "src/popup.html",
        "src/options.html",
        "src/languages.js",
    ]
    for rel in required:
        if not (ROOT / rel).exists():
            fail(f"missing {rel}")
    print("OK manifest and files")


def check_js_syntax() -> None:
    files = list((ROOT / "src").glob("*.js"))
    for path in files:
        result = subprocess.run(
            ["node", "--check", str(path)],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            fail(f"{path.name}: {result.stderr.strip()}")
    print(f"OK {len(files)} JS files")


def fetch(url: str) -> bytes:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "WikiPolyBar/1.0 (https://github.com/Jakson-Almeida/WikiPolyBar)"},
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        return response.read()


def check_wikipedia() -> None:
    html = fetch(ARTICLE).decode("utf-8", "replace")
    links = {}
    for tag in HREFLANG.findall(html):
        lang_match = LANG.search(tag)
        href_match = HREF.search(tag)
        if not lang_match or not href_match:
            continue
        links[lang_match.group(1).lower()] = href_match.group(1)
    for needed in ("pt", "es", "de", "fr"):
        if needed not in links:
            fail(f"article HTML missing hreflang={needed}")
        if "wikipedia.org/wiki/" not in links[needed]:
            fail(f"bad hreflang URL for {needed}: {links[needed]}")
    print(f"OK HTML interlanguage links ({len(links)} editions)")

    api = json.loads(fetch(API).decode("utf-8"))
    pages = api["query"]["pages"]
    page = next(iter(pages.values()))
    api_langs = {item["lang"] for item in page.get("langlinks", [])}
    for needed in ("pt", "es"):
        if needed not in api_langs:
            fail(f"API missing lang {needed}")
    print(f"OK API langlinks ({len(api_langs)} editions)")


def main() -> None:
    check_manifest()
    check_js_syntax()
    check_wikipedia()
    print("All checks passed")


if __name__ == "__main__":
    sys.exit(main())

# WikiPoly Bar

Instant language switcher and split-view comparator for official Wikipedia.

Wikipedia’s Vector 2022 skin hid the language list behind a collapsible control. WikiPoly Bar puts your languages back on the article as one-click buttons, without redirecting you to a third-party reader.

## Features

- Detects browser languages on first install (Portuguese, English, Spanish, and others you add)
- Floating bar on `*.wikipedia.org` articles with a button per preferred language
- Instant switch when that edition exists; unavailable editions stay disabled
- Keyboard shortcuts: `Alt+1`… for language 1, plus `Alt+Shift+1` (Chrome on Windows often steals `Alt+1` for tabs)
- Split view in the same tab to compare two official editions side by side
- Optional synced scrolling in split view
- Stays on wikipedia.org, so your Wikipedia account on that edition keeps working

## Install in Chrome

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked**
4. Select the `extension` folder (the one that contains `manifest.json`)

Pin the extension, then open any article such as [Python (programming language)](https://en.wikipedia.org/wiki/Python_(programming_language)). The bar appears under the site header. Click **PT**, **EN**, or **ES** to switch, or **Split view** to compare two editions.

Preferred languages and shortcut order are in the toolbar popup. Full settings live on the options page.

## Shortcuts

| Action | Keys |
| --- | --- |
| Preferred language 1–9 | `Alt+1` … `Alt+9` (if Chrome does not use the key for tabs) |
| Preferred language 1–3 | `Alt+Shift+1` … `Alt+Shift+3` |
| Toggle split view | `Alt+Shift+S` |
| Close split view | `Esc` |

Remap the extension commands at `chrome://extensions/shortcuts`.

## Privacy

Language preferences are stored in Chrome sync storage. The extension does not collect analytics. Split view only frames official Wikipedia pages; framing is limited to subframes so normal Wikipedia browsing is unchanged.

## Website

Marketing site (React + Node) lives in `website/`. From that folder: `npm install`, then `npm run dev`.


Toolbar icons and `extension/icons/favicon.ico` are generated with:

```
python scripts/generate_icons.py
```

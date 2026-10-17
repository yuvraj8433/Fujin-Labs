# Fujin Labs design rules

One look for every page: clean light surfaces, white cards, warm orange accents. All shared styling lives in `styles.css`. Pages only add layout that is unique to them.

## How to build a new page or feature
1. Link the shared styles and fonts in `<head>`:
   ```html
   <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap" rel="stylesheet">
   <link rel="stylesheet" href="styles.css">
   ```
2. Start from `<main>` with `.card` sections. Page width defaults to 520px; set `:root{--page:980px}` for wide pages like admin.
3. Reuse the components below. Do not write new colours, shadows or radii in a page. If something is missing, add it to `styles.css` first.
4. Check the page at phone width (375px) before shipping.

## Tokens (in `styles.css`)
| Token | Use |
|---|---|
| `--orange` `#e8590c` | Primary buttons, links, progress, highlights |
| `--orange-deep` `#c2410c` | Orange text, pressed states |
| `--orange-soft` / `--tint` | Pale orange fills (badges, hero, code box) |
| `--amber` `#ffb703` | Gradient partner for orange only |
| `--green` / `--green-soft` | Success, unlocked, "Paid / Sent" |
| `--warn` `#b42318` | Errors and delete |
| `--bg` `#faf7f3`, `--card` white, `--line` border, `--well` inset fill | Surfaces |
| `--ink` / `--muted` | Text |
| `--display` Bricolage Grotesque | Headings, big numbers, codes |
| `--body` Plus Jakarta Sans | Everything else |

## Components
- **Card** `.card`: white, 1px border, 18px radius, soft shadow. Use `.top` on a card for a header row (brand on the left, status or buttons on the right).
- **Buttons**: default orange; `.soft` outlined orange; `.danger` outlined red (use `.sure` for the armed second tap); `.wa` WhatsApp green; `.big` for the main form button.
- **Fields**: plain `input`, `select`, `textarea` inside a `label`. 48px minimum height, orange focus ring.
- **Stat tile** `.stats` grid with `.stat` (`<b>` number, `<span>` label). `.stat.alert` for numbers that need attention.
- **Progress** `.bar` with `<i style="width:40%">`. Distribution bars use `.bars` and `.tr`.
- **Pills and status**: `.pill`, `.pill.eligible` (orange), `.pill.paid` (green); `.conn` for a connection or section tag (`.demo` for the yellow demo state).
- **Messages**: `.msg` or `.hint` with `.ok` / `.bad`. `.banner` for notices.
- **Icon circle** `.ico` with an inline SVG, stroke `currentColor`.

## Rules
- Light theme only. No dark mode, no gradients except the orange to amber brand mark and progress bars.
- One accent: orange. Green means success only, red means error or delete only.
- Mobile first: single column, 16px side padding, touch targets at least 46px, inputs at 16px font so phones do not zoom.
- Write user-visible text from the user's side: plain words, no jargon, errors say how to fix it.
- Build DOM from user data with `textContent`, never `innerHTML`.
- Never put a password, key or personal data in a URL.
- When the Sheet columns change, update `Code.gs` (`HEADERS`) and redeploy a **new version**.

## Files
| File | Purpose |
|---|---|
| `index.html` | Page 1: sign-up form. Invite links (`?ref=CODE`) open here first, with the code locked |
| `refer.html` | Page 2: Refer & Earn (rewards, your code, share, referral count). The form sends people here |
| `admin.html` | Password-protected admin console (not linked publicly) |
| `styles.css` | Shared design system, upload with the pages |
| `config.js` | The one place for the Apps Script Web app URL (empty = demo mode) |
| `app.js` | Shared public-page code: backend calls, demo mode, saved visitor |
| `Code.gs` | Google Apps Script backend, pasted into the Sheet |

## Page flow
Invite link `index.html?ref=CODE` → form (code locked) → submit → `refer.html` shows the new person's own code. The visitor's email and code are kept in this device's `localStorage` (`fujin_user`), never in the URL. Invite links always point to `index.html`, so every new person fills the form first.

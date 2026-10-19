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
- **Data viewer** (admin): sortable, filterable table with a column picker, plus a referral tree. Names, "Referred by" and referral counts are `.linkbtn` buttons that open the **profile panel** (`.overlay` + `.sheet`): who referred them, everyone they referred (each clickable), their answers, and reward status and notes. Any new place that shows a person should link to `openProfile(code)` rather than invent its own detail view.
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
| `index.html` | Page 1: the sign-up form. Invite links (`?ref=CODE`) open here first, with the code locked |
| `refer.html` | Page 2: Refer & Earn (rewards, your code, share, referral count). The form sends people here |
| `admin.html` | Password-protected admin console (not linked publicly) |
| `styles.css` | Shared design system, upload with the pages |
| `config.js` | The one place for the Apps Script Web app URL |
| `app.js` | Shared public-page code: backend calls, icons, saved visitor |
| `formkit.js` | Draws a form from its question list and reads the answers. Used by `index.html` and by the admin live preview |
| `Code.gs` | Google Apps Script backend, pasted into the Sheet |

## The form
There is one form for everyone. The admin **Form** tab edits it, and `Code.gs` stores its definition in the `Forms` tab. `index.html` always shows it. Every submission is one row in the **Signups** tab of the Sheet, and every question is one column in that same tab, so all data lives in one place.

- Name and Email are always asked (they identify the person for referrals). Everything else is a question the admin adds. Types: short, long, email, phone, number, date, dropdown, radio, checkbox, consent.
- Column order in Signups is always: Timestamp, Name, Email, then every form question (one column each), then My Code, Referred By, Referral Count, Reward Status, Notes. Saving the form syncs the headers: a new question is inserted just before My Code, a renamed question renames its header, a deleted question keeps its column marked "(removed)" so no data is lost. The referral columns are found by their header names, so columns the owner adds elsewhere never break anything. Never reorder or insert columns inside the question block.
- Someone who submits again with the same email keeps their original answers and referrer.
- The server validates every submission against the saved form, so never rely on browser checks alone.
- Add a new question type in `FormKit.TYPES` and `build()` in `formkit.js`, plus `FIELD_TYPES` and `validateAnswers_` in `Code.gs`.
- **Referral codes** look like `FUJIN-A0001UPR`: `FUJIN-` is fixed, the letter is the year (A = 2026, B = 2027, ...), `0001` is the next sign-up number for that year, and the last three letters are the state from the form's State question (type `state`). One word = first three letters (Bihar = BIH); two words = first letter + first two letters of the second word (Uttar Pradesh = UPR); three or more = initials; "and", "of", "the" are ignored; no state = XXX. Codes are made in `newCode_` / `stateCode_` in `Code.gs`. Codes given out earlier keep their old format and keep working, so anything that checks a code must accept both (`/^FUJIN-[A-Z0-9]{4,14}$/`).
- Other tabs: `Forms` (form definition), `Rewards` (tiers). Old tabs from earlier versions (`Responses`, `Form - ...`) are left alone; their answers are copied into Signups once.

## Page flow
Invite link `index.html?ref=CODE` → form (code locked) → submit → `refer.html` shows the new person's own code. The visitor's email and code are kept in this device's `localStorage` (`fujin_user`), never in the URL. Invite links always point to `index.html`, so every new person fills the form first.

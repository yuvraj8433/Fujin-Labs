# Fujin Labs referral project

Before changing any page or adding UI, read `DESIGN.md` and use the shared `styles.css`. Every page must keep the same look: light theme, white cards, orange accents, mobile first. Do not add per-page colours or restyle shared components inside a page.

- Backend is Google Sheets through `Code.gs` (Apps Script). After editing it the user must deploy a new version.
- The user prefers to create Google Sheets and Forms themselves. Never create files in their Drive.
- Test pages in demo mode (empty `SHEET_API_URL`) or with the live URL, at 375px width.

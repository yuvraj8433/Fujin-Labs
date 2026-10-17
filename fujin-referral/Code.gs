// Fujin Labs sign-up + referral backend (Google Apps Script).
// Paste into Extensions > Apps Script of your Google Sheet, then Deploy > Web app (Execute as: Me, Access: Anyone).
// Admin password: Project Settings (gear icon) > Script properties > add  ADMIN_PASSWORD = <your password>

const SHEET_NAME = 'Signups';
const REWARDS_SHEET = 'Rewards';
const HEADERS = ['Timestamp', 'Name', 'Email', 'Company', 'Phone', 'Interest', 'My Code', 'Referred By', 'Referral Count', 'Reward Status', 'Notes'];
const REWARD_HEADERS = ['Referrals Needed', 'Reward', 'Type', 'Details'];
const STATUSES = ['None', 'Pending', 'Approved', 'Paid / Sent'];
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DEFAULT_TIERS = [   // placeholders: change them in the admin page or the Rewards tab
  [3, 'Rs 500 cash', 'Money', 'Sent to your UPI or bank account'],
  [10, 'Fujin Labs gift hamper', 'Gift', 'Delivered to your address'],
  [25, 'Rs 5,000 cash', 'Money', 'Sent to your UPI or bank account']
];

// ---------- sheets ----------
function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
  return sh;
}

function getRewardsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(REWARDS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(REWARDS_SHEET);
    sh.appendRow(REWARD_HEADERS);
    DEFAULT_TIERS.forEach(t => sh.appendRow(t));
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, REWARD_HEADERS.length).setFontWeight('bold');
  }
  return sh;
}

function rows_(sh) {
  const n = sh.getLastRow() - 1;
  return n > 0 ? sh.getRange(2, 1, n, HEADERS.length).getValues() : [];
}

function tiers_() {
  const sh = getRewardsSheet_();
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, 4).getValues()
    .filter(r => Number(r[0]) > 0 && String(r[1]).trim())
    .map(r => ({ need: Number(r[0]), reward: String(r[1]), type: String(r[2]) === 'Gift' ? 'Gift' : 'Money', details: String(r[3] || '') }))
    .sort((a, b) => a.need - b.need);
}

// ---------- helpers ----------
const safe_ = v => { v = String(v == null ? '' : v).trim(); return /^[=+\-@]/.test(v) ? "'" + v : v; };
const json_ = obj => ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
const countFor_ = (data, code) => data.filter(r => r[7] === code).length;

function newCode_(taken) {
  let code;
  do {
    code = 'FUJIN-';
    for (let i = 0; i < 4; i++) code += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
  } while (taken[code]);
  return code;
}

function checkAdmin_(password) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('admin_fails') || 0);
  if (fails >= 8) throw new Error('Too many wrong attempts. Try again in 10 minutes.');
  const real = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!real) throw new Error('Admin password is not set. Add ADMIN_PASSWORD in Script properties.');
  if (String(password || '') !== real) {
    cache.put('admin_fails', String(fails + 1), 600);
    throw new Error('Wrong password.');
  }
  cache.remove('admin_fails');
}

// ---------- web app ----------
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const req = JSON.parse(e.postData.contents);
    const sh = getSheet_();
    const data = rows_(sh);
    const email = String(req.email || '').trim().toLowerCase();

    // ----- public -----
    if (req.action === 'config') return json_({ tiers: tiers_() });

    if (req.action === 'check') {
      const code = String(req.code || '').trim().toUpperCase();
      const hit = data.find(r => r[6] === code);
      return json_(hit ? String(hit[1]).split(' ')[0] : null);
    }

    if (req.action === 'stats') {
      const me = data.find(r => String(r[2]).toLowerCase() === email);
      return json_(me ? { code: me[6], count: countFor_(data, me[6]), status: me[9] || 'None' } : null);
    }

    if (req.action === 'join') {
      const name = String(req.name || '').trim();
      if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json_({ error: 'invalid input' });

      // Already joined: the original referrer is kept and can never be changed.
      const existing = data.find(r => String(r[2]).toLowerCase() === email);
      if (existing) return json_({ code: existing[6], existing: true, count: countFor_(data, existing[6]), status: existing[9] || 'None' });

      const taken = {};
      data.forEach(r => taken[r[6]] = true);
      let ref = String(req.ref || '').trim().toUpperCase();
      if (!taken[ref]) ref = '';
      const code = newCode_(taken);
      const rowNum = sh.getLastRow() + 1;

      sh.appendRow([new Date(), safe_(name), email, safe_(req.company), safe_(req.phone), safe_(req.interest), code, ref, '', 'None', '']);
      sh.getRange(rowNum, 9).setFormula('=COUNTIF($H$2:$H, G' + rowNum + ')');
      return json_({ code: code, existing: false, count: 0, status: 'None' });
    }

    // ----- admin (password required on every call) -----
    if (String(req.action).indexOf('a_') === 0) {
      checkAdmin_(req.password);

      if (req.action === 'a_login') return json_({ ok: true });

      if (req.action === 'a_list') {
        const byCode = {};
        data.forEach(r => byCode[r[6]] = r);
        return json_({
          tiers: tiers_(),
          statuses: STATUSES,
          rows: data.map(r => ({
            ts: r[0], name: r[1], email: r[2], company: r[3], phone: String(r[4]), interest: r[5],
            code: r[6], ref: r[7], refName: r[7] && byCode[r[7]] ? byCode[r[7]][1] : '',
            count: countFor_(data, r[6]), status: r[9] || 'None', notes: r[10] || ''
          }))
        });
      }

      if (req.action === 'a_update') {
        const idx = data.findIndex(r => r[6] === req.code);
        if (idx < 0) return json_({ error: 'Not found' });
        const rowNum = idx + 2;
        if (STATUSES.indexOf(req.status) >= 0) sh.getRange(rowNum, 10).setValue(req.status);
        if (req.notes !== undefined) sh.getRange(rowNum, 11).setValue(safe_(req.notes));
        return json_({ ok: true });
      }

      if (req.action === 'a_delete') {
        const idx = data.findIndex(r => r[6] === req.code);
        if (idx < 0) return json_({ error: 'Not found' });
        sh.deleteRow(idx + 2);
        return json_({ ok: true });
      }

      if (req.action === 'a_tiers') {
        const list = (req.tiers || []).filter(t => Number(t.need) > 0 && String(t.reward).trim()).slice(0, 12);
        const rs = getRewardsSheet_();
        if (rs.getLastRow() > 1) rs.getRange(2, 1, rs.getLastRow() - 1, 4).clearContent();
        list.forEach((t, i) => rs.getRange(i + 2, 1, 1, 4).setValues([[Number(t.need), safe_(t.reward), t.type === 'Gift' ? 'Gift' : 'Money', safe_(t.details)]]));
        return json_({ ok: true, tiers: tiers_() });
      }
    }

    return json_({ error: 'unknown action' });
  } catch (err) {
    return json_({ error: String(err && err.message ? err.message : err) });
  } finally {
    lock.releaseLock();
  }
}

// Open the web app URL in a browser to confirm it is live.
function doGet() {
  return ContentService.createTextOutput('Fujin Labs sign-up API is running.');
}

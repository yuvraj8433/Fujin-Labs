// Fujin Labs forms + referral backend (Google Apps Script).
// Paste into Extensions > Apps Script of your Google Sheet, then Deploy > Web app (Execute as: Me, Access: Anyone).
// Admin password: Project Settings (gear icon) > Script properties > add  ADMIN_PASSWORD = <your password>
// Tabs it creates: Signups (one row per person), Responses (every form submission), Forms (form definitions), Rewards (reward tiers).

const SHEET_NAME = 'Signups';
const REWARDS_SHEET = 'Rewards';
const FORMS_SHEET = 'Forms';
const RESP_SHEET = 'Responses';
const HEADERS = ['Timestamp', 'Name', 'Email', 'Company', 'Phone', 'Interest', 'My Code', 'Referred By', 'Referral Count', 'Reward Status', 'Notes', 'Form ID'];
const REWARD_HEADERS = ['Referrals Needed', 'Reward', 'Type', 'Details'];
const FORM_HEADERS = ['ID', 'Title', 'Description', 'Fields', 'Settings', 'Status', 'Created', 'Updated'];
const RESP_HEADERS = ['Timestamp', 'Form ID', 'Name', 'Email', 'Code', 'Answers'];
const STATUSES = ['None', 'Pending', 'Approved', 'Paid / Sent'];
const FIELD_TYPES = ['short', 'long', 'email', 'phone', 'number', 'date', 'dropdown', 'radio', 'checkbox', 'consent'];
const CHOICE_TYPES = ['dropdown', 'radio', 'checkbox'];
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DEFAULT_TIERS = [   // placeholders: change them in the admin page or the Rewards tab
  [3, 'Rs 500 cash', 'Money', 'Sent to your UPI or bank account'],
  [10, 'Fujin Labs gift hamper', 'Gift', 'Delivered to your address'],
  [25, 'Rs 5,000 cash', 'Money', 'Sent to your UPI or bank account']
];
const DEFAULT_FORM = {
  id: 'default',
  title: 'Join Fujin Labs',
  description: 'Tell us a little about you. It takes about a minute, and you can start earning rewards right after.',
  status: 'Published',
  settings: { submitLabel: 'Submit and continue', referral: true, after: 'refer', message: '' },
  fields: [
    { id: 'company', type: 'short', label: 'Company', help: '', required: false, options: [] },
    { id: 'phone', type: 'phone', label: 'Phone', help: '', required: false, options: [] },
    { id: 'interest', type: 'dropdown', label: 'What are you interested in?', help: '', required: true, options: ['Product demo', 'Consulting', 'Partnership', 'Something else'] },
    { id: 'consent', type: 'consent', label: 'I agree that Fujin Labs may contact me about this request.', help: '', required: true, options: [] }
  ]
};

// ---------- sheets ----------
function makeSheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  const fresh = !sh;
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  return { sh: sh, fresh: fresh };
}

function getSheet_() {
  const sh = makeSheet_(SHEET_NAME, HEADERS).sh;
  if (!sh.getRange(1, HEADERS.length).getValue()) {            // older sheets: add the newest header
    sh.getRange(1, HEADERS.length).setValue(HEADERS[HEADERS.length - 1]).setFontWeight('bold');
  }
  return sh;
}

function getRewardsSheet_() {
  const made = makeSheet_(REWARDS_SHEET, REWARD_HEADERS);
  if (made.fresh) DEFAULT_TIERS.forEach(t => made.sh.appendRow(t));
  return made.sh;
}

function getFormsSheet_() {
  const made = makeSheet_(FORMS_SHEET, FORM_HEADERS);
  if (made.sh.getLastRow() < 2) writeForm_(made.sh, DEFAULT_FORM, null);
  return made.sh;
}

function getRespSheet_() { return makeSheet_(RESP_SHEET, RESP_HEADERS).sh; }

function rows_(sh, cols) {
  const n = sh.getLastRow() - 1;
  return n > 0 ? sh.getRange(2, 1, n, cols).getValues() : [];
}

function tiers_() {
  const rows = rows_(getRewardsSheet_(), 4);
  return rows
    .filter(r => Number(r[0]) > 0 && String(r[1]).trim())
    .map(r => ({ need: Number(r[0]), reward: String(r[1]), type: String(r[2]) === 'Gift' ? 'Gift' : 'Money', details: String(r[3] || '') }))
    .sort((a, b) => a.need - b.need);
}

// ---------- forms ----------
function parse_(s, fallback) { try { return JSON.parse(s); } catch (e) { return fallback; } }

function readForms_() {
  return rows_(getFormsSheet_(), FORM_HEADERS.length).map(r => ({
    id: String(r[0]), title: String(r[1]), description: String(r[2]),
    fields: parse_(r[3], []), settings: parse_(r[4], {}), status: String(r[5]) === 'Draft' ? 'Draft' : 'Published'
  }));
}

function getForm_(id) { return readForms_().find(f => f.id === id) || null; }

function str_(v, max) { return String(v == null ? '' : v).trim().slice(0, max); }

function cleanField_(f, used) {
  f = f || {};
  const type = FIELD_TYPES.indexOf(f.type) >= 0 ? f.type : 'short';
  let id = /^[a-z][a-z0-9_]{0,23}$/.test(String(f.id)) && ['name', 'email', 'ref'].indexOf(f.id) < 0 ? String(f.id) : '';
  while (!id || used[id]) id = 'q' + Math.random().toString(36).slice(2, 8);
  used[id] = true;
  const options = CHOICE_TYPES.indexOf(type) >= 0
    ? (Array.isArray(f.options) ? f.options : []).map(o => str_(o, 100)).filter(Boolean).slice(0, 50)
    : [];
  return { id: id, type: type, label: str_(f.label, 200) || 'Untitled question', help: str_(f.help, 300), required: !!f.required, options: options };
}

function cleanForm_(f) {
  f = f || {};
  const used = {};
  const s = f.settings || {};
  return {
    id: /^[a-z0-9]{3,20}$/.test(String(f.id)) ? String(f.id) : '',
    title: str_(f.title, 120) || 'Untitled form',
    description: str_(f.description, 600),
    status: f.status === 'Draft' ? 'Draft' : 'Published',
    settings: {
      submitLabel: str_(s.submitLabel, 40) || 'Submit',
      referral: s.referral !== false,
      after: s.after === 'message' ? 'message' : 'refer',
      message: str_(s.message, 500)
    },
    fields: (Array.isArray(f.fields) ? f.fields : []).slice(0, 40).map(x => cleanField_(x, used))
  };
}

function writeForm_(sh, f, existingRow) {
  const now = new Date();
  const line = [f.id, f.title, f.description, JSON.stringify(f.fields), JSON.stringify(f.settings), f.status];
  if (existingRow) {
    sh.getRange(existingRow, 1, 1, 6).setValues([line]);
    sh.getRange(existingRow, 8).setValue(now);
  } else {
    sh.appendRow(line.concat([now, now]));
  }
}

function newFormId_() {
  const ids = readForms_().map(f => f.id);
  let id;
  do { id = 'f' + Math.random().toString(36).slice(2, 8); } while (ids.indexOf(id) >= 0);
  return id;
}

// Check one submission against the form's own rules. Returns { answers } (id -> {l, v}) or { error }.
function validateAnswers_(form, raw) {
  const out = {};
  for (let i = 0; i < form.fields.length; i++) {
    const f = form.fields[i];
    let v = raw[f.id];
    const empty = v == null || v === '' || v === false || (Array.isArray(v) && v.length === 0);
    if (empty) {
      if (f.required) return { error: '"' + f.label + '" is required.' };
      continue;
    }
    if (f.type === 'consent') { v = true; }
    else if (f.type === 'checkbox') {
      if (!Array.isArray(v) || v.some(x => f.options.indexOf(x) < 0)) return { error: 'Choose valid options for "' + f.label + '".' };
      v = v.slice(0, 50);
    } else {
      v = String(v).trim();
      if (f.type === 'dropdown' || f.type === 'radio') { if (f.options.indexOf(v) < 0) return { error: 'Choose a valid option for "' + f.label + '".' }; }
      else if (f.type === 'email') { if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) || v.length > 200) return { error: 'Enter a valid email for "' + f.label + '".' }; }
      else if (f.type === 'phone') { if (!/^[+\d][\d\s\-()]{5,19}$/.test(v)) return { error: 'Enter a valid phone number for "' + f.label + '".' }; }
      else if (f.type === 'number') { if (!isFinite(Number(v))) return { error: 'Enter a number for "' + f.label + '".' }; }
      else if (f.type === 'date') { if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return { error: 'Enter a valid date for "' + f.label + '".' }; }
      else { v = v.slice(0, f.type === 'long' ? 2000 : 300); }
    }
    out[f.id] = { l: f.label, v: v };
  }
  return { answers: out };
}

// ---------- helpers ----------
const safe_ = v => { v = String(v == null ? '' : v).trim(); return /^[=+\-@]/.test(v) ? "'" + v : v; };
const json_ = obj => ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
const countFor_ = (data, code) => data.filter(r => r[7] === code).length;
const flat_ = a => a && a.v !== undefined ? (Array.isArray(a.v) ? a.v.join(', ') : (a.v === true ? 'Yes' : a.v)) : '';

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
    const data = rows_(sh, HEADERS.length);
    const email = String(req.email || '').trim().toLowerCase();

    // ----- public -----
    if (req.action === 'config') return json_({ tiers: tiers_() });

    if (req.action === 'form') {
      const form = getForm_(String(req.id || 'default'));
      if (!form || form.status !== 'Published') return json_({ error: 'This form is not available right now.' });
      return json_({ form: form });
    }

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
      const name = str_(req.name, 120);
      if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json_({ error: 'Enter your name and a valid email.' });

      const form = getForm_(String(req.formId || 'default'));
      if (!form || form.status !== 'Published') return json_({ error: 'This form is not available right now.' });
      const checked = validateAnswers_(form, req.answers || {});
      if (checked.error) return json_({ error: checked.error });
      const a = checked.answers;

      const existing = data.find(r => String(r[2]).toLowerCase() === email);
      let code, status = 'None', count = 0;

      if (existing) {
        // The original referrer is kept and can never be changed.
        code = existing[6]; status = existing[9] || 'None'; count = countFor_(data, code);
      } else {
        const taken = {};
        data.forEach(r => taken[r[6]] = true);
        let ref = form.settings.referral === false ? '' : String(req.ref || '').trim().toUpperCase();
        if (!taken[ref]) ref = '';
        code = newCode_(taken);
        const rowNum = sh.getLastRow() + 1;
        sh.appendRow([new Date(), safe_(name), email, safe_(flat_(a.company)), safe_(flat_(a.phone)), safe_(flat_(a.interest)), code, ref, '', 'None', '', form.id]);
        sh.getRange(rowNum, 9).setFormula('=COUNTIF($H$2:$H, G' + rowNum + ')');
      }

      getRespSheet_().appendRow([new Date(), form.id, safe_(name), email, code, JSON.stringify(a)]);
      return json_({ code: code, existing: !!existing, count: count, status: status, after: form.settings.after, message: form.settings.message });
    }

    // ----- admin (password required on every call) -----
    if (String(req.action).indexOf('a_') === 0) {
      checkAdmin_(req.password);

      if (req.action === 'a_login') return json_({ ok: true });

      if (req.action === 'a_list') {
        const byCode = {};
        data.forEach(r => byCode[r[6]] = r);
        const resp = rows_(getRespSheet_(), RESP_HEADERS.length);
        const perForm = {};
        resp.forEach(r => perForm[r[1]] = (perForm[r[1]] || 0) + 1);
        return json_({
          tiers: tiers_(),
          statuses: STATUSES,
          forms: readForms_().map(f => Object.assign(f, { responses: perForm[f.id] || 0 })),
          responses: resp.slice(-5000).map(r => ({ ts: r[0], formId: r[1], name: r[2], email: r[3], code: r[4], answers: parse_(r[5], {}) })),
          rows: data.map(r => ({
            ts: r[0], name: r[1], email: r[2], company: r[3], phone: String(r[4]), interest: r[5],
            code: r[6], ref: r[7], refName: r[7] && byCode[r[7]] ? byCode[r[7]][1] : '',
            count: countFor_(data, r[6]), status: r[9] || 'None', notes: r[10] || '', formId: r[11] || 'default'
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
        const mail = String(data[idx][2]).toLowerCase();
        sh.deleteRow(idx + 2);
        const rs = getRespSheet_();
        const resp = rows_(rs, RESP_HEADERS.length);
        for (let i = resp.length - 1; i >= 0; i--) if (String(resp[i][3]).toLowerCase() === mail) rs.deleteRow(i + 2);
        return json_({ ok: true });
      }

      if (req.action === 'a_tiers') {
        const list = (req.tiers || []).filter(t => Number(t.need) > 0 && String(t.reward).trim()).slice(0, 12);
        const rs = getRewardsSheet_();
        if (rs.getLastRow() > 1) rs.getRange(2, 1, rs.getLastRow() - 1, 4).clearContent();
        list.forEach((t, i) => rs.getRange(i + 2, 1, 1, 4).setValues([[Number(t.need), safe_(t.reward), t.type === 'Gift' ? 'Gift' : 'Money', safe_(t.details)]]));
        return json_({ ok: true, tiers: tiers_() });
      }

      if (req.action === 'a_form_save') {
        const f = cleanForm_(req.form);
        const fs = getFormsSheet_();
        const rows = rows_(fs, FORM_HEADERS.length);
        const idx = f.id ? rows.findIndex(r => String(r[0]) === f.id) : -1;
        if (f.id && idx < 0) return json_({ error: 'That form no longer exists.' });
        if (idx < 0) f.id = newFormId_();
        if (f.id === 'default') f.status = 'Published';
        writeForm_(fs, f, idx < 0 ? null : idx + 2);
        return json_({ ok: true, form: f });
      }

      if (req.action === 'a_form_delete') {
        const id = String(req.id || '');
        if (id === 'default') return json_({ error: 'The main form cannot be deleted. You can edit it instead.' });
        const fs = getFormsSheet_();
        const idx = rows_(fs, FORM_HEADERS.length).findIndex(r => String(r[0]) === id);
        if (idx < 0) return json_({ error: 'Not found' });
        fs.deleteRow(idx + 2);
        return json_({ ok: true });
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

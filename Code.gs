// Fujin Labs sign-up form + referral backend (Google Apps Script).
// Paste into Extensions > Apps Script of your Google Sheet, then Deploy > Web app (Execute as: Me, Access: Anyone).
// Admin password: Project Settings (gear icon) > Script properties > add  ADMIN_PASSWORD = <your password>
//
// Everything lives in ONE tab, "Signups": one row per person, one column per form question.
// Other tabs: Forms (the form's definition), Rewards (reward tiers). Old tabs from earlier versions are left alone.

const SHEET_NAME = 'Signups';
const REWARDS_SHEET = 'Rewards';
const FORMS_SHEET = 'Forms';
const FORM_ID = 'default';
const HEADERS = ['Timestamp', 'Name', 'Email', 'Company', 'Phone', 'Interest', 'My Code', 'Referred By', 'Referral Count', 'Reward Status', 'Notes'];
const QSTART = HEADERS.length + 1;                       // column 12: the first extra question column
const LEGACY = { company: 4, phone: 5, interest: 6 };    // questions with these ids use the original columns D, E, F
const REWARD_HEADERS = ['Referrals Needed', 'Reward', 'Type', 'Details'];
const FORM_HEADERS = ['ID', 'Title', 'Description', 'Fields', 'Settings', 'Status', 'Created', 'Updated', 'Sheet ID', 'Columns'];
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
  id: FORM_ID,
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
  // An earlier version added a "Form ID" column here. It is no longer used, so remove it before questions take its place.
  if (sh.getLastColumn() >= QSTART && sh.getRange(1, QSTART).getValue() === 'Form ID') sh.deleteColumn(QSTART);
  return sh;
}

function getRewardsSheet_() {
  const made = makeSheet_(REWARDS_SHEET, REWARD_HEADERS);
  if (made.fresh) DEFAULT_TIERS.forEach(t => made.sh.appendRow(t));
  return made.sh;
}

function getFormsSheet_() {
  const made = makeSheet_(FORMS_SHEET, FORM_HEADERS);
  const sh = made.sh;
  [9, 10].forEach(c => {
    if (!sh.getRange(1, c).getValue()) sh.getRange(1, c).setValue(FORM_HEADERS[c - 1]).setFontWeight('bold');
  });
  if (!rows_(sh, FORM_HEADERS.length).some(r => String(r[0]) === FORM_ID)) writeForm_(sh, DEFAULT_FORM, null);
  return sh;
}

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

// ---------- the one form ----------
function parse_(s, fallback) { try { return JSON.parse(s); } catch (e) { return fallback; } }
function str_(v, max) { return String(v == null ? '' : v).trim().slice(0, max); }

// The form plus where each question lives. cols = ids of the question columns that start at column 12 (null = not set up yet).
function readForm_() {
  const r = rows_(getFormsSheet_(), FORM_HEADERS.length).map((x, i) => ({ x: x, row: i + 2 })).find(o => String(o.x[0]) === FORM_ID);
  const m = parse_(r.x[9], null);
  return {
    id: FORM_ID, title: String(r.x[1]), description: String(r.x[2]),
    fields: parse_(r.x[3], []), settings: parse_(r.x[4], {}), status: String(r.x[5]) === 'Draft' ? 'Draft' : 'Published',
    _row: r.row, cols: m && !Array.isArray(m) && Array.isArray(m.cols) ? m.cols : null,
    _oldSheetId: r.x[8] === '' ? '' : String(r.x[8]), _oldCols: Array.isArray(m) ? m : []
  };
}

const publicForm_ = f => ({ id: f.id, title: f.title, description: f.description, fields: f.fields, settings: f.settings, status: f.status });

function cleanField_(f, used) {
  f = f || {};
  const type = FIELD_TYPES.indexOf(f.type) >= 0 ? f.type : 'short';
  let id = typeof f.id === 'string' && /^[a-z][a-z0-9_]{0,23}$/.test(f.id) && ['name', 'email', 'ref', 'undefined', 'null'].indexOf(f.id) < 0 ? f.id : '';
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
    id: FORM_ID,
    title: str_(f.title, 120) || 'Join Fujin Labs',
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

// ---------- questions become columns in Signups ----------
const colOf_ = (form, id) => LEGACY[id] || QSTART + form.cols.indexOf(id);
const stripRemoved_ = s => String(s).replace(/ \(removed\)$/, '');

// Makes the Signups headers match the form: a new question gets a new column on the right, a renamed question renames
// its header, and a deleted question keeps its column marked "(removed)" so no data is lost. Columns you add yourself
// to the right of the questions are pushed along, never overwritten.
function syncColumns_(form) {
  const sh = getSheet_();
  const prev = form.cols || [];
  const cols = prev.slice();
  form.fields.forEach(f => { if (!LEGACY[f.id] && cols.indexOf(f.id) < 0) cols.push(f.id); });
  const head = sh.getRange(1, 1, 1, Math.max(QSTART + cols.length, sh.getLastColumn())).getValues()[0];
  cols.forEach((id, i) => {
    if (prev.indexOf(id) < 0 && String(head[QSTART - 1 + i] || '') !== '') {   // spot taken by one of your own columns
      sh.insertColumnBefore(QSTART + i);
      head.splice(QSTART - 1 + i, 0, '');
    }
  });
  const used = {};
  const label = (id, idx) => {
    const f = form.fields.find(x => x.id === id);
    let text = f ? f.label : stripRemoved_(head[idx - 1] || id) + ' (removed)';
    const base = text; let n = 2;
    while (used[text]) text = base + ' (' + (n++) + ')';
    used[text] = true;
    return safe_(text);
  };
  Object.keys(LEGACY).forEach(id => { head[LEGACY[id] - 1] = label(id, LEGACY[id]); });
  cols.forEach((id, i) => { head[QSTART - 1 + i] = label(id, QSTART + i); });
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
  sh.setFrozenRows(1);
  getFormsSheet_().getRange(form._row, 9, 1, 2).setValues([['', JSON.stringify({ v: 2, cols: cols })]]);
  form.cols = cols;
  return cols;
}

// Older versions kept answers in a separate "Form - ..." tab. Copy them into the question columns once.
function migrateOldTab_(form) {
  const oldTab = form._oldSheetId ? SpreadsheetApp.getActiveSpreadsheet().getSheets().find(s => String(s.getSheetId()) === form._oldSheetId && s.getName() !== SHEET_NAME) : null;
  form.cols = [];
  syncColumns_(form);
  if (!oldTab || oldTab.getLastRow() < 2 || !form._oldCols.length) return;
  const sh = getSheet_();
  const people = rows_(sh, QSTART - 1 + form.cols.length);
  const byEmail = {};
  people.forEach((r, i) => byEmail[String(r[2]).toLowerCase()] = { r: r, row: i + 2 });
  const oldRows = rows_(oldTab, 5 + form._oldCols.length);
  oldRows.forEach(o => {
    const p = byEmail[String(o[2]).toLowerCase()];
    if (!p) return;
    form._oldCols.forEach((id, i) => {
      const v = o[5 + i];
      if (v === '' || v == null || !form.fields.some(f => f.id === id)) return;
      const c = colOf_(form, id);
      if (c > 0 && (p.r[c - 1] === '' || p.r[c - 1] == null)) sh.getRange(p.row, c).setValue(v);
    });
  });
}

function ensureColumns_(form) {
  if (form.cols === null) { migrateOldTab_(form); return; }
  if (form.fields.some(f => !LEGACY[f.id] && form.cols.indexOf(f.id) < 0)) syncColumns_(form);
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

// What goes into a cell for one answer.
function cellValue_(form, id, a) {
  if (!a) return '';
  const f = form.fields.find(q => q.id === id);
  if (f && f.type === 'number') return Number(a.v);
  const text = safe_(flat_(a));
  return f && f.type === 'phone' && /^\d/.test(text) ? "'" + text : text;     // keep leading zeros
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
    const form = readForm_();
    ensureColumns_(form);                                   // keeps the sheet's columns in step with the form
    const width = Math.max(QSTART - 1 + form.cols.length, sh.getLastColumn());
    const data = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues() : [];
    const email = String(req.email || '').trim().toLowerCase();

    // ----- public -----
    if (req.action === 'config') return json_({ tiers: tiers_() });

    if (req.action === 'form') {
      if (form.status !== 'Published') return json_({ error: 'This form is closed right now.' });
      return json_({ form: publicForm_(form) });
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
      if (form.status !== 'Published') return json_({ error: 'This form is closed right now.' });
      const checked = validateAnswers_(form, req.answers || {});
      if (checked.error) return json_({ error: checked.error });
      const a = checked.answers;

      const existing = data.find(r => String(r[2]).toLowerCase() === email);
      if (existing) {
        // Already signed up: their original answers and referrer are kept and can never be changed from the form.
        return json_({ code: existing[6], existing: true, count: countFor_(data, existing[6]), status: existing[9] || 'None', after: form.settings.after, message: form.settings.message });
      }

      const taken = {};
      data.forEach(r => taken[r[6]] = true);
      let ref = form.settings.referral === false ? '' : String(req.ref || '').trim().toUpperCase();
      if (!taken[ref]) ref = '';
      const code = newCode_(taken);
      const rowNum = sh.getLastRow() + 1;

      const row = [new Date(), safe_(name), email, '', '', '', code, ref, '', 'None', ''];
      form.fields.forEach(f => {
        if (LEGACY[f.id] || form.cols.indexOf(f.id) >= 0) row[colOf_(form, f.id) - 1] = cellValue_(form, f.id, a[f.id]);
      });
      for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = '';
      sh.appendRow(row);
      sh.getRange(rowNum, 9).setFormula('=COUNTIF($H$2:$H, G' + rowNum + ')');
      return json_({ code: code, existing: false, count: 0, status: 'None', after: form.settings.after, message: form.settings.message });
    }

    // ----- admin (password required on every call) -----
    if (String(req.action).indexOf('a_') === 0) {
      checkAdmin_(req.password);

      if (req.action === 'a_login') return json_({ ok: true });

      if (req.action === 'a_list') {
        const head = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
        const byCode = {};
        data.forEach(r => byCode[r[6]] = r);
        const answerIds = Object.keys(LEGACY).concat(form.cols);
        return json_({
          tiers: tiers_(),
          statuses: STATUSES,
          sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl() + '#gid=' + sh.getSheetId(),
          form: Object.assign(publicForm_(form), { columns: QSTART - 1 + form.cols.length }),
          rows: data.map(r => {
            const answers = {};
            answerIds.forEach(id => {
              let v = r[colOf_(form, id) - 1];
              if (v === '' || v == null) return;
              if (v instanceof Date) v = v.toISOString().slice(0, 10);
              answers[id] = { l: stripRemoved_(head[colOf_(form, id) - 1] || id), v: v };
            });
            return {
              ts: r[0], name: r[1], email: r[2], company: r[3], phone: String(r[4]), interest: r[5],
              code: r[6], ref: r[7], refName: r[7] && byCode[r[7]] ? byCode[r[7]][1] : '',
              count: countFor_(data, r[6]), status: r[9] || 'None', notes: r[10] || '', answers: answers
            };
          })
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

      if (req.action === 'a_form_save') {
        const f = cleanForm_(req.form);
        writeForm_(getFormsSheet_(), f, form._row);
        const saved = readForm_();
        syncColumns_(saved);                                // new questions become columns right now
        return json_({ ok: true, form: publicForm_(saved), columns: QSTART - 1 + saved.cols.length, sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl() + '#gid=' + sh.getSheetId() });
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

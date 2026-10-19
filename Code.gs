// Fujin Labs sign-up form + referral backend (Google Apps Script).
// Paste into Extensions > Apps Script of your Google Sheet, then Deploy > Web app (Execute as: Me, Access: Anyone).
// Admin password: Project Settings (gear icon) > Script properties > add  ADMIN_PASSWORD = <your password>
//
// Everything lives in ONE tab, "Signups": one row per person. Column order:
//   Timestamp | Name | Email | <your form questions, one column each> | My Code | Referred By | Referral Count | Reward Status | Notes
// A new question is inserted just before "My Code", so your answers always sit together, then the referral columns.
// Other tabs: Forms (the form's definition), Rewards (reward tiers). Old tabs from earlier versions are left alone.

const SHEET_NAME = 'Signups';
const REWARDS_SHEET = 'Rewards';
const FORMS_SHEET = 'Forms';
const FORM_ID = 'default';
const SYS = ['My Code', 'Referred By', 'Referral Count', 'Reward Status', 'Notes'];      // the columns after the questions
const HEADERS = ['Timestamp', 'Name', 'Email'].concat(SYS);                               // a brand new sheet starts like this
const QSTART = 4;                                                                         // first question column (1-based)
const LEGACY_IDS = ['company', 'phone', 'interest'];                                      // the three question columns older sheets already had
const REWARD_HEADERS = ['Referrals Needed', 'Reward', 'Type', 'Details'];
const FORM_HEADERS = ['ID', 'Title', 'Description', 'Fields', 'Settings', 'Status', 'Created', 'Updated', 'Sheet ID', 'Columns'];
const STATUSES = ['None', 'Pending', 'Approved', 'Paid / Sent'];
const FIELD_TYPES = ['short', 'long', 'email', 'phone', 'number', 'date', 'dropdown', 'radio', 'checkbox', 'consent', 'state'];
const CHOICE_TYPES = ['dropdown', 'radio', 'checkbox'];
const INDIAN_STATES = ["Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chhattisgarh","Goa","Gujarat","Haryana","Himachal Pradesh","Jharkhand","Karnataka","Kerala","Madhya Pradesh","Maharashtra","Manipur","Meghalaya","Mizoram","Nagaland","Odisha","Punjab","Rajasthan","Sikkim","Tamil Nadu","Telangana","Tripura","Uttar Pradesh","Uttarakhand","West Bengal","Andaman and Nicobar Islands","Chandigarh","Dadra and Nagar Haveli and Daman and Diu","Delhi","Jammu and Kashmir","Ladakh","Lakshadweep","Puducherry"];
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
    { id: 'state', type: 'state', label: 'State', help: 'Used for your referral code.', required: true, options: INDIAN_STATES },
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
  // An earlier version added a "Form ID" column. It is no longer used, so remove it.
  const at = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].indexOf('Form ID') : -1;
  if (at >= 0) sh.deleteColumn(at + 1);
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

// The form plus where its questions live. state: 'v3' = columns sit before My Code, 'v2' = extra questions were
// stored after Notes (previous version), 'old' = even older. cols = ids of the question columns, left to right.
function readForm_() {
  const r = rows_(getFormsSheet_(), FORM_HEADERS.length).map((x, i) => ({ x: x, row: i + 2 })).find(o => String(o.x[0]) === FORM_ID);
  const m = parse_(r.x[9], null);
  const obj = m && !Array.isArray(m) && typeof m === 'object' ? m : null;
  return {
    id: FORM_ID, title: String(r.x[1]), description: String(r.x[2]),
    fields: parse_(r.x[3], []), settings: parse_(r.x[4], {}), status: String(r.x[5]) === 'Draft' ? 'Draft' : 'Published',
    _row: r.row,
    state: obj && obj.v === 3 ? 'v3' : obj && obj.v === 2 ? 'v2' : 'old',
    cols: obj && obj.v === 3 && Array.isArray(obj.cols) ? obj.cols : [],
    _v2cols: obj && obj.v === 2 && Array.isArray(obj.cols) ? obj.cols : [],
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
  const options = type === 'state' ? INDIAN_STATES.slice()
    : CHOICE_TYPES.indexOf(type) >= 0
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

// ---------- questions are columns in Signups, between Email and My Code ----------
const stripRemoved_ = s => String(s).replace(/ \(removed\)$/, '');

function colLetter_(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// Where the referral columns are right now (0-based), found by their headers so columns you add yourself never break anything.
function layout_(sh, form) {
  const head = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
  const n = form.cols.length;
  const at = (name, fallback) => { const i = head.lastIndexOf(name); return i >= 0 ? i : fallback; };
  return { head: head, code: at('My Code', 3 + n), ref: at('Referred By', 4 + n), count: at('Referral Count', 5 + n), status: at('Reward Status', 6 + n), notes: at('Notes', 7 + n) };
}

// Makes the Signups headers match the form. A new question gets a new column just before "My Code", a renamed question
// renames its header, and a deleted question keeps its column marked "(removed)" so no data is lost.
function syncColumns_(form) {
  const sh = getSheet_();
  const prev = form.cols;
  const cols = prev.slice();
  form.fields.forEach(f => { if (cols.indexOf(f.id) < 0) cols.push(f.id); });
  for (let i = prev.length; i < cols.length; i++) sh.insertColumnBefore(QSTART + i);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const used = {};
  cols.forEach((id, i) => {
    const f = form.fields.find(x => x.id === id);
    let text = f ? f.label : stripRemoved_(head[QSTART - 1 + i] || id) + ' (removed)';
    const base = text; let n = 2;
    while (used[text]) text = base + ' (' + (n++) + ')';
    used[text] = true;
    head[QSTART - 1 + i] = safe_(text);
  });
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
  sh.setFrozenRows(1);
  getFormsSheet_().getRange(form._row, 9, 1, 2).setValues([['', JSON.stringify({ v: 3, cols: cols })]]);
  form.cols = cols;
  form.state = 'v3';
  return cols;
}

// Older sheets: bring everything into the order Name | Email | questions | My Code | ... | Notes.
function upgradeLayout_(form) {
  const sh = getSheet_();
  const head = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
  const codeIdx = head.lastIndexOf('My Code');
  const extras = form.state === 'v2' ? form._v2cols : [];
  let cols = [];
  if (codeIdx - 3 === LEGACY_IDS.length) {
    cols = LEGACY_IDS.slice();                                // the old Company | Phone | Interest columns
    const k = extras.length;
    if (k > 0) {                                              // extra questions were after Notes: move them in front of My Code
      const last = sh.getLastRow();
      const from = head.lastIndexOf('Notes') + 2;             // 1-based column of the first extra question
      for (let i = 0; i < k; i++) sh.insertColumnBefore(codeIdx + 1);
      const moved = sh.getRange(1, from + k, last, k).getValues();
      sh.getRange(1, codeIdx + 1, last, k).setValues(moved);
      for (let i = 0; i < k; i++) sh.deleteColumn(from + k);
      cols = cols.concat(extras);
    }
  }
  form.cols = cols;
  getFormsSheet_().getRange(form._row, 9, 1, 2).setValues([[form._oldSheetId, JSON.stringify({ v: 3, cols: cols })]]);
  form.state = 'v3';
  syncColumns_(form);                                         // adds a column for any question that has none yet
  copyFromOldTab_(form);
}

// The oldest versions kept answers in a separate "Form - ..." tab. Copy them into the question columns once.
function copyFromOldTab_(form) {
  const oldTab = form._oldSheetId ? SpreadsheetApp.getActiveSpreadsheet().getSheets().find(s => String(s.getSheetId()) === form._oldSheetId && s.getName() !== SHEET_NAME) : null;
  if (!oldTab || oldTab.getLastRow() < 2 || !form._oldCols.length) return;
  const sh = getSheet_();
  const people = rows_(sh, sh.getLastColumn());
  const byEmail = {};
  people.forEach((r, i) => byEmail[String(r[2]).toLowerCase()] = { r: r, row: i + 2 });
  rows_(oldTab, 5 + form._oldCols.length).forEach(o => {
    const p = byEmail[String(o[2]).toLowerCase()];
    if (!p) return;
    form._oldCols.forEach((id, i) => {
      const v = o[5 + i], c = form.cols.indexOf(id);
      if (v === '' || v == null || c < 0) return;
      if (p.r[QSTART - 1 + c] === '' || p.r[QSTART - 1 + c] == null) sh.getRange(p.row, QSTART + c).setValue(v);
    });
  });
  getFormsSheet_().getRange(form._row, 9).setValue('');
}

function ensureColumns_(form) {
  if (form.state !== 'v3') upgradeLayout_(form);
  else if (form.fields.some(f => form.cols.indexOf(f.id) < 0)) syncColumns_(form);
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
      if (f.type === 'dropdown' || f.type === 'radio' || f.type === 'state') { if (f.options.indexOf(v) < 0) return { error: 'Choose a valid option for "' + f.label + '".' }; }
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
const flat_ = a => a && a.v !== undefined ? (Array.isArray(a.v) ? a.v.join(', ') : (a.v === true ? 'Yes' : a.v)) : '';

// Three letters for a state: one word = its first three letters (Bihar = BIH); two words = first letter of the first
// word + first two letters of the second (Uttar Pradesh = UPR); three or more = their initials (Dadra Nagar Haveli = DNH).
// "and", "of" and "the" are ignored. No state given = XXX.
function stateCode_(name) {
  const words = String(name || '').replace(/&/g, ' ').split(/[^A-Za-z]+/)
    .filter(w => w && ['and', 'of', 'the'].indexOf(w.toLowerCase()) < 0).map(w => w.toUpperCase());
  if (!words.length) return 'XXX';
  if (words.length === 1) return (words[0].slice(0, 3) + 'XX').slice(0, 3);
  if (words.length === 2) return (words[0][0] + words[1].slice(0, 2) + 'XX').slice(0, 3);
  return words.slice(0, 3).map(w => w[0]).join('');
}

// FUJIN-A0001UPR: A = the year (A = 2026, B = 2027, ...), 0001 = the next sign-up number for that year, UPR = the state.
function newCode_(taken, stateName) {
  const letter = String.fromCharCode(65 + Math.min(25, Math.max(0, new Date().getFullYear() - 2026)));
  let max = 0;
  Object.keys(taken).forEach(c => { const m = /^FUJIN-([A-Z])(\d{4,})[A-Z]{3}$/.exec(c); if (m && m[1] === letter) max = Math.max(max, Number(m[2])); });
  let n = max + 1, code;
  do { code = 'FUJIN-' + letter + String(n).padStart(4, '0') + stateCode_(stateName); n++; } while (taken[code]);
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
    const L = layout_(sh, form);
    const data = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues() : [];
    const countFor = code => data.filter(r => r[L.ref] === code).length;
    const email = String(req.email || '').trim().toLowerCase();

    // ----- public -----
    if (req.action === 'config') return json_({ tiers: tiers_() });

    if (req.action === 'form') {
      if (form.status !== 'Published') return json_({ error: 'This form is closed right now.' });
      return json_({ form: publicForm_(form) });
    }

    if (req.action === 'check') {
      const code = String(req.code || '').trim().toUpperCase();
      const hit = data.find(r => r[L.code] === code);
      return json_(hit ? String(hit[1]).split(' ')[0] : null);
    }

    if (req.action === 'stats') {
      const me = data.find(r => String(r[2]).toLowerCase() === email);
      return json_(me ? { code: me[L.code], count: countFor(me[L.code]), status: me[L.status] || 'None' } : null);
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
        return json_({ code: existing[L.code], existing: true, count: countFor(existing[L.code]), status: existing[L.status] || 'None', after: form.settings.after, message: form.settings.message });
      }

      const taken = {};
      data.forEach(r => taken[r[L.code]] = true);
      let ref = form.settings.referral === false ? '' : String(req.ref || '').trim().toUpperCase();
      if (!taken[ref]) ref = '';
      const stateField = form.fields.find(f => f.type === 'state');
      const code = newCode_(taken, stateField && a[stateField.id] ? a[stateField.id].v : '');
      const rowNum = sh.getLastRow() + 1;

      const row = new Array(Math.max(L.notes + 1, sh.getLastColumn())).fill('');
      row[0] = new Date(); row[1] = safe_(name); row[2] = email;
      form.fields.forEach(f => { row[QSTART - 1 + form.cols.indexOf(f.id)] = cellValue_(form, f.id, a[f.id]); });
      row[L.code] = code; row[L.ref] = ref; row[L.status] = 'None';
      sh.appendRow(row);
      const refCol = colLetter_(L.ref + 1);
      sh.getRange(rowNum, L.count + 1).setFormula('=COUNTIF($' + refCol + '$2:$' + refCol + ', ' + colLetter_(L.code + 1) + rowNum + ')');
      return json_({ code: code, existing: false, count: 0, status: 'None', after: form.settings.after, message: form.settings.message });
    }

    // ----- admin (password required on every call) -----
    if (String(req.action).indexOf('a_') === 0) {
      checkAdmin_(req.password);

      if (req.action === 'a_login') return json_({ ok: true });

      if (req.action === 'a_list') {
        const byCode = {};
        data.forEach(r => byCode[r[L.code]] = r);
        return json_({
          tiers: tiers_(),
          statuses: STATUSES,
          sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl() + '#gid=' + sh.getSheetId(),
          form: Object.assign(publicForm_(form), { columns: sh.getLastColumn() }),
          rows: data.map(r => {
            const answers = {};
            form.cols.forEach((id, i) => {
              let v = r[QSTART - 1 + i];
              if (v === '' || v == null) return;
              if (v instanceof Date) v = v.toISOString().slice(0, 10);
              if (typeof v === 'string' && v.charAt(0) === "'") v = v.slice(1);
              answers[id] = { l: stripRemoved_(L.head[QSTART - 1 + i] || id), v: v };
            });
            const val = id => answers[id] ? String(answers[id].v) : '';
            return {
              ts: r[0], name: r[1], email: r[2], company: val('company'), phone: val('phone'), interest: val('interest'),
              code: r[L.code], ref: r[L.ref], refName: r[L.ref] && byCode[r[L.ref]] ? byCode[r[L.ref]][1] : '',
              count: countFor(r[L.code]), status: r[L.status] || 'None', notes: r[L.notes] || '', answers: answers
            };
          })
        });
      }

      if (req.action === 'a_update') {
        const idx = data.findIndex(r => r[L.code] === req.code);
        if (idx < 0) return json_({ error: 'Not found' });
        const rowNum = idx + 2;
        if (STATUSES.indexOf(req.status) >= 0) sh.getRange(rowNum, L.status + 1).setValue(req.status);
        if (req.notes !== undefined) sh.getRange(rowNum, L.notes + 1).setValue(safe_(req.notes));
        return json_({ ok: true });
      }

      if (req.action === 'a_delete') {
        const idx = data.findIndex(r => r[L.code] === req.code);
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
        return json_({ ok: true, form: publicForm_(saved), columns: sh.getLastColumn(), sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl() + '#gid=' + sh.getSheetId() });
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

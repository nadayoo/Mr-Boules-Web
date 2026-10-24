// Phone numbers for the "Missed Lessons" WhatsApp buttons.
// Numbers are kept ONLY in this browser (localStorage), never in the database.
// No Firebase code here, so it is easy to test.
//
// The sheet needs three columns: student ID, student's phone, parent's phone.

const DEFAULT_CC = '20';                 // Egypt: 01012345678 -> 201012345678
const SAUDI_CC = '966';                  // local 05xxxxxxxx numbers -> Saudi Arabia (05x...)
const KEY = 'bm_contacts_v2';

// ---------- reading a CSV / pasted table ----------
export function parseTable(text) {
  const t = String(text || '').replace(/^\uFEFF/, '');
  const firstLine = t.split(/\r?\n/, 1)[0] || '';
  const delim = firstLine.includes('\t') ? '\t' : ',';
  const rows = [];
  let row = [], cell = '', inQ = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inQ) {
      if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  const headers = (rows.shift() || []).map((h) => h.trim());
  return { headers, rows: rows.map((r) => r.map((c) => c.trim())) };
}

// Best guess of which column is which, from the header names: { id, student, parent }
export function guessColumns(headers) {
  const find = (re, skip = []) => headers.findIndex((h, i) => !skip.includes(i) && re.test(h));
  const parent = find(/parent|mother|mom|mum|father|dad|guardian/i);
  let id = find(/^(student\s*)?(id|code)$/i, [parent]);
  if (id < 0) id = find(/\bid\b|code/i, [parent]);
  let student = find(/student.*(phone|mobile|number|whats|tel)|^(mobile|phone|number|whatsapp|tel)/i, [parent, id]);
  if (student < 0) student = find(/phone|mobile|whats|tel|number/i, [parent, id]);
  return { id, student, parent };
}

// ---------- phone numbers ----------
// Arabic-Indic digits (٠١٢…) and Persian digits (۰۱۲…) -> 0123…
const toAscii = (s) => String(s)
  .replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660))
  .replace(/[\u06F0-\u06F9]/g, (c) => String(c.charCodeAt(0) - 0x06F0));

// A real Egyptian mobile: +20, then 10 / 11 / 12 / 15, then 8 digits (e.g. 201012345678)
const EG_MOBILE = /^20(10|11|12|15)\d{8}$/;

export function normalizePhone(raw, cc = DEFAULT_CC) {
  const s = toAscii(raw).trim();
  if (!s) return '';
  const plus = s.startsWith('+');
  let d = s.replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  else if (plus) { /* already international */ }
  else if (/^05\d{8}$/.test(d)) return SAUDI_CC + d.slice(1);   // 05xxxxxxxx = Saudi mobile typed locally (Egyptian mobiles never start 05)
  else if (d.startsWith('0')) {                         // local number: only Egyptian mobiles can be fixed up safely
    d = cc + d.slice(1);
    return EG_MOBILE.test(d) ? d : '';                  // e.g. 05xxxxxxxx (Saudi/UAE) or a typo -> not guessed
  }
  else if (d.length === 10 && d.startsWith('1')) {      // Egyptian mobile typed without the leading 0
    d = cc + d;
    return EG_MOBILE.test(d) ? d : '';
  }
  else if (d.length < 10) return '';                    // no country code and too short to be international
  return d.length >= 8 && d.length <= 15 ? d : '';
}

// A cell may hold several numbers ("0100... / 0111..."); the first one is used
export function extractNumbers(cell) {
  return String(cell || '').split(/[\/,;|\n]+/).map((p) => normalizePhone(p)).filter(Boolean);
}

export function waLink(number, text) {
  return `https://wa.me/${number}?text=${encodeURIComponent(text || '')}`;
}

// ---------- building and finding contacts ----------
// map = { id, student, parent }  (column numbers, or -1 / null when not used)
export function buildContacts(rows, map) {
  const byId = {};
  const bad = [];                                       // IDs whose numbers could not be used
  let count = 0;
  const cellOf = (row, i) => (i === null || i === undefined || i < 0 ? '' : row[i] || '');
  for (const row of rows) {
    const id = cellOf(row, map.id).trim().toUpperCase();
    if (!id || id.startsWith('#')) continue;            // blank or #N/A row
    const student = extractNumbers(cellOf(row, map.student))[0] || '';
    const parent = extractNumbers(cellOf(row, map.parent))[0] || '';
    if (!student && !parent) { if (cellOf(row, map.student).trim() || cellOf(row, map.parent).trim()) bad.push(id); continue; }
    byId[id] = { student, parent };
    count++;
  }
  return { byId, count, bad, at: new Date().toISOString() };
}

// Adds the imported students to the numbers already saved. Students in the new file get their numbers
// added or updated (an empty cell keeps the old number); students NOT in the file are left alone.
export function mergeContacts(old, add) {
  const byId = { ...((old && old.byId) || {}) };
  let added = 0, updated = 0;
  for (const [id, rec] of Object.entries(add.byId)) {
    const prev = byId[id];
    if (!prev) { byId[id] = { student: rec.student, parent: rec.parent }; added++; continue; }
    const next = { student: rec.student || prev.student, parent: rec.parent || prev.parent };
    if (next.student !== prev.student || next.parent !== prev.parent) updated++;
    byId[id] = next;
  }
  return { byId, count: Object.keys(byId).length, bad: add.bad || [], added, updated, at: new Date().toISOString() };
}

export function lookupContact(contacts, who) {
  if (!contacts || !contacts.byId) return null;
  const id = String((who && who.id) || '').trim().toUpperCase();
  return (id && contacts.byId[id]) || null;
}

// ---------- kept in this browser only ----------
export function loadContacts() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
}
export function saveContacts(c) {
  try { localStorage.setItem(KEY, JSON.stringify(c)); return true; } catch (e) { return false; }
}
export function clearContacts() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}

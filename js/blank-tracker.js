// Admin tool: homework PDFs that need a look. Same layout as "Missed lessons".
//   - Empty file / just the homework sheet: flagged in the student's browser when they submit (see pdf-check.js)
//   - Same file as another student: flagged on the server (functions/duplicates.js)
// Two choices per file:  "File is fine" (a mistake, forgotten)  or  "Student contacted" (a real offence: it is counted in the
// "Repeat offenses" tab). Both are saved for all admins in the blankAcks collection.
// Kept in this browser only: the phone numbers for the WhatsApp buttons (the same ones as Missed lessons).
import { db, esc, toast } from './config.js';
import {
  collection, getDocs, getDoc, doc, query, where, orderBy, limit, setDoc, deleteField, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { state } from './auth.js';
import { openModal } from './modal.js';
import { GROUPS, usesGroups, cleanLessonTitle } from './groups.js';
import { testReferenceAccess } from './pdf-check.js';
import {
  parseTable, guessColumns, buildContacts, lookupContact, waLink,
  loadContacts, saveContacts, clearContacts, mergeContacts
} from './contacts.js';

const SUBJECTS = { olcam: 'Cambridge', oledx: 'Edexcel' };
const FONT = "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif";
const REPEAT = 'repeat';

// ---- the WhatsApp messages. Change the wording here if you like. *Name* is shown in bold by WhatsApp.
const INTRO = (me) => `Hello, I’m *${me}*, Mr. Boules’s assistant.`;
const THANKS = 'Thank you for your cooperation.';
const MESSAGE = {
  blank: (r, me) => `${INTRO(me)} The files you submitted for ${list} were empty. Please make sure you submit your completed work for every homework. Your homework is marked as missed, and your parent will be contacted next time this happens. ${THANKS}`,
  dup: (r, me) => `${INTRO(me)} The file you submitted for ${hwName(r)} is identical to a file another student submitted and this is unacceptable. Please make sure you submit your own work. Your homework is marked as missed, and your parent will be contacted next time this happens. ${THANKS}`,
  repeat: (list, me) => `${INTRO(me)} The files you submitted for ${list} were empty. Please make sure you submit your completed work for every homework. Your homework is marked as missed, and your parent will be contacted next time this happens. ${THANKS}`,
};

// "farah@gmail.com" -> "Farah"
function adminName() {
  const local = String(state.userEmail || '').split('@')[0];
  const first = local.split(/[._\-+\d]+/).find(Boolean) || 'Assistant';
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

const lc = (e) => String(e || '').trim().toLowerCase();
const normG = (g) => String(g == null ? '' : g).trim().toLowerCase();
const hwName = (r) => cleanLessonTitle(r.homeworkTitle) || r.hwCode || r.homeworkId || 'the homework';
const hwShort = (r) => (r.hwCode ? String(r.hwCode).toUpperCase() : hwName(r));
const urlHash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };

const freshView = () => ({
  subject: 'olcam', group: 'all', mode: 'list', rows: null, acks: {}, ids: {}, msg: '', imp: null, contacts: loadContacts(), repeatFlat: [],
});
let view = freshView();
const el = (id) => document.getElementById(id);

export async function openBlankTracker() {
  if (!state.isAdmin) return;
  view = freshView();

  const m = document.getElementById('modal');
  m.style.width = 'min(96vw, 1000px)';
  m.style.maxWidth = 'none';
  m.style.maxHeight = '94vh';
  m.style.overflowY = 'auto';

  m.innerHTML = `
    <h2>Blank files</h2>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px;">
      <select id="bt-subject" onchange="window.btSubject(this.value)">
        ${Object.entries(SUBJECTS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
      </select>
      <button class="btn-cancel" onclick="window.btRefresh()">Refresh</button>
      <button class="btn-cancel" onclick="window.btImport()"><i class="ti ti-brand-whatsapp"></i> Import numbers</button>
    </div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:11.5px;color:var(--paper-text-faint);margin-bottom:6px;">
      <span id="bt-contacts"></span><span id="bt-sheetcheck"></span>
    </div>
    <div id="bt-msg"></div>
    <div id="bt-tabs"></div>
    <div id="bt-body" style="max-height:calc(90vh - 300px);min-height:180px;overflow:auto;margin-top:8px;"></div>
    <details style="font-size:11.5px;color:var(--paper-text-faint);margin-top:10px;">
      <summary style="cursor:pointer;">How this works</summary>
      <div style="margin-top:6px;line-height:1.5;">
        Files are flagged when no page has writing, when the file is just the homework sheet, or when it is identical to another student's file.<br>
        <b>File is fine</b>: it was a mistake, it is forgotten. <b>Student contacted</b>: it counts as an offence and moves to <b>Repeat offenses</b>.<br>
        The empty/sheet check runs in the student's browser when they submit, so older files are not checked, and re-printed or scanned copies of the sheet are not recognised.
        Phone numbers are saved only in this browser and are shared with Missed lessons.
      </div>
    </details>
    <div class="modal-footer"><button class="btn-cancel" onclick="closeModal()">Close</button></div>`;
  openModal();
  contactsLine();
  sheetCheckStatus();
  await load();
}

function contactsLine() {
  const box = el('bt-contacts');
  if (!box) return;
  const c = view.contacts;
  box.innerHTML = c
    ? `WhatsApp numbers: ${c.count} students · <a href="#" onclick="window.btClearNumbers();return false;" style="text-decoration:underline;">Remove</a>`
    : 'No phone numbers yet. Use "Import numbers".';
}

// Can the "just the sheet" check read the homework PDFs? Tried on the newest homework of the chosen subject (1 read).
async function sheetCheckStatus() {
  const box = el('bt-sheetcheck');
  if (!box) return;
  const say = (color, text) => { const b = el('bt-sheetcheck'); if (b) b.innerHTML = `<span style="color:${color};">● ${text}</span>`; };
  try {
    const snap = await getDocs(query(collection(db, `${view.subject}_homework`), orderBy('createdAt', 'desc'), limit(1)));
    let url = '';
    snap.forEach((d) => { const p = (d.data().pdfs || [])[0]; if (p) url = p; });
    if (!url) { say('#9a9288', 'Sheet check: nothing to test with'); return; }
    const t = await testReferenceAccess(url);
    if (t.ok) say('#2e7d32', 'Sheet check on');
    else say('#b3261e', `Sheet check OFF (${esc(t.reason)}): the storage bucket needs its CORS setting. Only empty files are caught.`);
  } catch (e) {
    say('#9a9288', 'Sheet check: could not be tested');
  }
}

// ------------------------------------------------------------------ data
async function load() {
  const body = el('bt-body');
  if (body) body.innerHTML = '<div style="padding:14px 0;font-size:13px;">Loading…</div>';
  try {
    // flagged submissions (empty / sheet only, and same-file), the ticks, and the record of each student involved (for their ID)
    const [blankSnap, dupSnap] = await Promise.all([
      getDocs(query(collection(db, 'submissions'), where('blank', '==', true))),
      getDocs(query(collection(db, 'submissions'), where('dup', '==', true))),
    ]);
    const flagged = {};
    for (const snap of [blankSnap, dupSnap]) snap.forEach((d) => { flagged[d.id] = { subId: d.id, ...d.data() }; });

    const acks = {};
    let ackOk = true;
    try { (await getDocs(collection(db, 'blankAcks'))).forEach((d) => { acks[d.id] = { ackId: d.id, ...d.data() }; }); }
    catch (e) { ackOk = false; console.warn('Could not load the ticks', e); }

    const emails = new Set();
    Object.values(flagged).forEach((x) => { emails.add(lc(x.email)); (x.dupOf || []).forEach((o) => emails.add(lc(o.email))); });
    Object.values(acks).forEach((a) => { if (a.contacted && a.email) emails.add(lc(a.email)); });
    emails.delete('');
    const ids = {};
    await Promise.all([...emails].map(async (e) => {
      try { const s = await getDoc(doc(db, 'students', e)); if (s.exists()) ids[e] = String(s.data().id || ''); } catch (err) {}
    }));

    view.acks = acks;
    view.ids = ids;
    view.flagged = flagged;
    view.rows = Object.values(flagged)
      .map((x) => ({ ...x, email: lc(x.email), id: ids[lc(x.email)] || '' }))
      .filter((x) => !ackFor(x) || !(ackFor(x).ok || ackFor(x).contacted))      // already ticked files stay hidden; a replaced file is a new file
      .sort((a, b) => stamp(b) - stamp(a));
    view.msg = ackOk ? '' : "Couldn't load the ticks saved by other admins.";
  } catch (e) {
    console.error(e);
    view.rows = [];
    view.msg = "Couldn't load the flagged files. Check the connection and press Refresh.";
  }
  render();
}

// the tick that belongs to THIS file (a replaced file has a new url, so it has no tick yet)
function ackFor(r) {
  if (!r || !r.url) return null;
  for (const a of Object.values(view.acks)) if (a.url === r.url) return a;
  return null;
}

const stamp = (x) => {
  const t = x.replacedAt || x.submittedAt;
  return t && typeof t.toMillis === 'function' ? t.toMillis() : 0;
};
const when = (x) => {
  const ms = typeof x === 'number' ? x : stamp(x);
  return ms ? new Date(ms).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
};

// confirmed offences of one student (the "Student contacted" ticks), oldest first
function offencesOf(email, subject) {
  return Object.values(view.acks)
    .filter((a) => a.contacted && lc(a.email) === lc(email) && (a.subject || '') === subject)
    .sort((a, b) => (a.at || 0) - (b.at || 0));
}
const offenceLabel = (a) => (a.hwCode ? String(a.hwCode).toUpperCase() : (cleanLessonTitle(a.homeworkTitle) || 'older record'));

// ------------------------------------------------------------------ list
function waButton(href, label) {
  return `<a href="${esc(href)}" target="_blank" rel="noopener"
    style="display:inline-flex;align-items:center;gap:6px;text-decoration:none;font-family:${FONT};font-size:12.5px;font-weight:600;
    padding:6px 12px;border-radius:999px;background:#25D366;color:#fff;white-space:nowrap;">
    <i class="ti ti-brand-whatsapp"></i> ${esc(label)}</a>`;
}
const noNumber = `<span style="font-family:${FONT};font-size:11.5px;color:#9a9288;">No number</span>`;

function whatsappFor(who, text, label) {
  if (!view.contacts) return '';
  const c = lookupContact(view.contacts, who);
  return c && c.student ? waButton(waLink(c.student, text), label) : noNumber;
}

const kindOf = (r) => (r.dup ? 'dup' : (r.blankInfo && r.blankInfo.kind === 'copy' ? 'copy' : 'empty'));
const KIND_LABEL = { empty: 'Empty', copy: 'Sheet only', dup: 'Same file' };
const KIND_COLOR = { empty: '#b3261e', copy: '#8a6d1d', dup: '#1565c0' };

function pill(label, on, color, onclick) {
  return `<button onclick="${onclick}" style="font-family:${FONT};font-size:12px;font-weight:600;padding:5px 12px;border-radius:999px;cursor:pointer;
    border:1px solid ${on ? color : '#cfc8bb'};background:${on ? color : '#fff'};color:${on ? '#fff' : '#4a443a'};">${label}</button>`;
}

function tabsHtml(pending) {
  const grouped = usesGroups(view.subject);
  const counts = {};
  for (const x of pending) { const g = normG(x.group); if (g) counts[g] = (counts[g] || 0) + 1; }
  const known = GROUPS.map(normG);
  const extra = Object.keys(counts).filter((g) => !known.includes(g)).sort();
  const btn = (key, label, n) => `
    <button class="${view.group === key ? 'btn-primary' : 'btn-cancel'}" style="margin:0 6px 6px 0;padding:5px 12px;font-size:12.5px;"
      onclick="window.btGroup('${esc(key)}')">${label} (${n})</button>`;
  const students = new Set(Object.values(view.acks).filter((a) => a.contacted && (a.subject || '') === view.subject).map((a) => lc(a.email))).size;
  return `<div style="margin-top:6px;">`
    + btn('all', 'All', pending.length)
    + (grouped ? GROUPS.map((g) => btn(normG(g), `Group ${esc(g)}`, counts[normG(g)] || 0)).join('') + extra.map((g) => btn(g, `Group ${esc(g)}`, counts[g])).join('') : '')
    + btn(REPEAT, 'Repeat offenses', students)
    + `</div>`;
}

function rowHtml(r, idx) {
  const a = ackFor(r) || {};
  const done = !!(a.ok || a.contacted);
  const kind = kindOf(r);
  const bi = r.blankInfo && !r.blankInfo.unchecked ? r.blankInfo : null;
  const pages = kind !== 'dup' && bi ? ` · ${bi.pages} page${bi.pages === 1 ? '' : 's'}` : '';
  const g = usesGroups(r.subject || view.subject) && normG(r.group) ? ` · Group ${esc(normG(r.group))}` : '';
  const prior = offencesOf(r.email, r.subject || view.subject).filter((o) => o.url !== r.url);
  const me = adminName();

  let other = '', otherBtn = '';
  if (kind === 'dup' && r.dupOf && r.dupOf.length) {
    const o = r.dupOf[0];
    const oid = view.ids[lc(o.email)] || '';
    other = `<div style="font-size:12px;margin-top:2px;">Same as <b>${esc(oid || '(no id)')} · ${esc(o.email)}</b> (${esc(o.hwCode ? String(o.hwCode).toUpperCase() : 'HW')})
      <a href="${esc(o.url)}" target="_blank" rel="noopener" style="text-decoration:underline;">their PDF ↗</a>${r.dupOf.length > 1 ? ` +${r.dupOf.length - 1} more` : ''}</div>`;
    otherBtn = whatsappFor({ id: oid }, MESSAGE.dup(r, me), 'Other student');
  }
  const text = kind === 'dup' ? MESSAGE.dup(r, me) : MESSAGE.blank(r, me);

  return `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:12px 0;border-top:1px solid var(--paper-line,#e5e0d6);${done ? 'opacity:.5;' : ''}">
      <div style="min-width:0;flex:1;">
        <div style="font-family:${FONT};font-weight:700;font-size:15px;color:#1f1b16;word-break:break-word;">
          ${esc(r.id || '(no id)')} · ${esc(r.email)}
          <span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;margin-left:6px;color:#fff;background:${KIND_COLOR[kind]};vertical-align:middle;">${KIND_LABEL[kind]}</span>
        </div>
        <div style="font-size:12.5px;margin-top:2px;">${esc(hwName(r))}${r.hwCode ? ` (${esc(String(r.hwCode).toUpperCase())})` : ''}${g}
          <span style="color:var(--paper-text-faint);">${esc(pages)}${when(r) ? ' · ' + esc(when(r)) : ''}</span></div>
        ${other}
        ${prior.length ? `<div style="font-size:12px;color:#b3261e;margin-top:2px;">Earlier: ${prior.map((o) => esc(offenceLabel(o))).join(' · ')}</div>` : ''}
        <div style="display:flex;gap:6px;margin-top:8px;">
          ${pill('File is fine', !!a.ok, '#2e7d32', `window.btMark(${idx}, 'ok')`)}
          ${pill('Student contacted', !!a.contacted, '#1f1b16', `window.btMark(${idx}, 'contacted')`)}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex:none;">
        <a href="${esc(r.url)}" target="_blank" rel="noopener"
           style="display:inline-flex;align-items:center;gap:6px;text-decoration:none;font-family:${FONT};font-size:12.5px;font-weight:600;
           padding:6px 12px;border-radius:999px;background:#1f1b16;color:#fff;white-space:nowrap;">
          <i class="ti ti-file-type-pdf"></i> Open PDF ↗</a>
        ${whatsappFor(r, text, 'Student')}
        ${otherBtn}
      </div>
    </div>`;
}

// the "Repeat offenses" tab: every student who has been contacted, with how many times
function repeatHtml() {
  const by = {};
  for (const a of Object.values(view.acks)) {
    if (!a.contacted || (a.subject || '') !== view.subject || !a.email) continue;
    (by[lc(a.email)] = by[lc(a.email)] || []).push(a);
  }
  const people = Object.entries(by)
    .map(([email, list]) => ({ email, id: view.ids[email] || (list.find((x) => x.id) || {}).id || '', list: list.sort((x, y) => (x.at || 0) - (y.at || 0)) }))
    .sort((a, b) => b.list.length - a.list.length || (b.list[b.list.length - 1].at || 0) - (a.list[a.list.length - 1].at || 0));
  view.repeatFlat = [];
  if (!people.length) return `<div style="font-size:13px;padding:10px 0;">Nobody yet. Students you mark as <b>contacted</b> are counted here.</div>`;
  const me = adminName();
  return people.map((p) => {
    const n = p.list.length;
    const chips = p.list.map((a) => {
      const i = view.repeatFlat.push(a) - 1;
      return `<span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;border:1px solid #dcd5c8;border-radius:999px;padding:3px 6px 3px 10px;margin:0 6px 6px 0;">
        ${esc(offenceLabel(a))}${normG(a.group) ? ` · G${esc(normG(a.group))}` : ''}${a.at ? ` · ${esc(when(a.at))}` : ''}
        <a href="#" title="Remove this record (it goes back to the list)" onclick="window.btUndo(${i});return false;" style="text-decoration:none;color:#9a9288;">✕</a></span>`;
    }).join('');
    const list = p.list.map(offenceLabel).join(', ');
    return `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:12px 0;border-top:1px solid var(--paper-line,#e5e0d6);">
        <div style="min-width:0;flex:1;">
          <div style="font-family:${FONT};font-weight:700;font-size:15px;color:#1f1b16;word-break:break-word;">
            ${esc(p.id || '(no id)')} · ${esc(p.email)}
            <span style="font-size:11px;font-weight:700;padding:2px 9px;border-radius:999px;margin-left:6px;color:#fff;background:${n >= 2 ? '#b3261e' : '#8a6d1d'};vertical-align:middle;">×${n}</span>
          </div>
          <div style="margin-top:6px;">${chips}</div>
        </div>
        <div style="flex:none;">${whatsappFor({ id: p.id }, MESSAGE.repeat(list, me), 'Student')}</div>
      </div>`;
  }).join('');
}

function render() {
  if (!view.rows) return;
  view.mode = 'list';
  const mine = view.rows.filter((x) => (x.subject || '') === view.subject);
  const isDone = (x) => { const a = ackFor(x); return !!(a && (a.ok || a.contacted)); };
  const pending = mine.filter((x) => !isDone(x));
  el('bt-tabs').innerHTML = tabsHtml(pending);

  const msgBox = el('bt-msg');
  if (msgBox) msgBox.innerHTML = view.msg ? `<div style="background:#fdecea;color:#b3261e;padding:8px 12px;border-radius:8px;font-size:12.5px;margin-bottom:8px;">${esc(view.msg)}</div>` : '';

  if (view.group === REPEAT) { el('bt-body').innerHTML = repeatHtml(); return; }
  const visible = mine.filter((x) => view.group === 'all' || normG(x.group) === view.group);
  el('bt-body').innerHTML = visible.length
    ? visible.map((x) => rowHtml(x, view.rows.indexOf(x))).join('')
    : `<div style="font-size:13px;padding:10px 0;">Nothing to check${mine.length ? ' in this group' : ''}.</div>`;
}

// Choose one of the two for a file (choosing the same one again clears it). They exclude each other.
// A ticked file stays on screen, dimmed, until the next Refresh. "contacted" is also remembered for the Repeat offenses tab.
export async function btMark(idx, kind) {
  const r = (view.rows || [])[idx];
  if (!r || (kind !== 'ok' && kind !== 'contacted')) return;
  const cur = ackFor(r);
  const turnOn = !(cur && cur[kind]);
  const ackId = cur ? cur.ackId : `${r.subId}~${urlHash(r.url || '')}`;
  const now = Date.now();
  try {
    await setDoc(doc(db, 'blankAcks', ackId), {
      subject: r.subject || view.subject, email: r.email, id: r.id || '', url: r.url,
      homeworkTitle: r.homeworkTitle || '', hwCode: r.hwCode || '', group: r.group || '', flag: kindOf(r),
      ok: kind === 'ok' && turnOn ? true : deleteField(),
      contacted: kind === 'contacted' && turnOn ? true : deleteField(),
      at: (cur && cur.at) || now, updatedBy: state.userEmail || 'admin', updatedAt: serverTimestamp(),
    }, { merge: true });
    const next = { ...(cur || {}), ackId, subject: r.subject || view.subject, email: r.email, id: r.id || '', url: r.url,
      homeworkTitle: r.homeworkTitle || '', hwCode: r.hwCode || '', group: r.group || '', flag: kindOf(r), at: (cur && cur.at) || now };
    delete next.ok; delete next.contacted;
    if (kind === 'ok' && turnOn) next.ok = true;
    if (kind === 'contacted' && turnOn) next.contacted = true;
    view.acks[ackId] = next;
    view.msg = '';
  } catch (e) {
    console.error(e);
    view.msg = "Couldn't save that (check your Firestore rules for the blankAcks collection). Nothing was changed.";
  }
  render();
}

// Remove one record from "Repeat offenses" (a mistake). The file goes back to the list on the next Refresh if it is still flagged.
export async function btUndo(i) {
  const a = (view.repeatFlat || [])[i];
  if (!a) return;
  if (!window.confirm('Remove this record? It will not count as an offence any more.')) return;
  try {
    await setDoc(doc(db, 'blankAcks', a.ackId), { contacted: deleteField(), updatedBy: state.userEmail || 'admin', updatedAt: serverTimestamp() }, { merge: true });
    const cur = view.acks[a.ackId];
    if (cur) delete cur.contacted;
    view.msg = '';
  } catch (e) {
    console.error(e);
    view.msg = "Couldn't remove that record. Nothing was changed.";
  }
  render();
}

// ------------------------------------------------------------------ importing phone numbers (same as Missed lessons)
export function btImport() {
  view.mode = 'import';
  view.imp = null;
  view.msg = '';
  renderImport();
}

function renderImport() {
  el('bt-tabs').innerHTML = '';
  const msgBox = el('bt-msg');
  if (msgBox) msgBox.innerHTML = view.msg ? `<div style="background:#fdecea;color:#b3261e;padding:8px 12px;border-radius:8px;font-size:12.5px;margin-bottom:8px;">${esc(view.msg)}</div>` : '';
  const body = el('bt-body');
  const faint = 'font-size:12.5px;color:var(--paper-text-faint);';

  if (!view.imp) {
    body.innerHTML = `
      <div style="font-weight:600;margin-bottom:6px;">Import phone numbers</div>
      <div style="${faint}margin-bottom:10px;line-height:1.5;">
        Choose the .csv from your sheet, or paste the table. Columns: student ID, student's phone, parent's phone.
        New students are added, students in the file are updated, the rest are kept.
      </div>
      <input type="file" id="bt-file" accept=".csv,.tsv,.txt,text/csv" onchange="window.btFile(this)" />
      <textarea id="bt-paste" rows="5" style="margin-top:10px;width:100%;" placeholder="…or paste the table here"></textarea>
      <div style="margin-top:10px;display:flex;gap:8px;">
        <button class="btn-primary" onclick="window.btReadPaste()">Read table</button>
        <button class="btn-cancel" onclick="window.btImportCancel()">Cancel</button>
      </div>`;
    return;
  }

  const { headers, rows, map } = view.imp;
  const select = (id, current) => `
    <select id="${id}">
      <option value="">(none)</option>
      ${headers.map((h, i) => `<option value="${i}" ${current === i ? 'selected' : ''}>${esc(h || `Column ${i + 1}`)}</option>`).join('')}
    </select>`;
  const field = (label, html) => `<div style="margin-bottom:8px;"><div style="${faint}">${label}</div>${html}</div>`;
  const sample = rows.slice(0, 3).map((r) => `<div>${esc(r.slice(0, 6).join('  |  '))}</div>`).join('');

  body.innerHTML = `
    <div style="font-weight:600;margin-bottom:6px;">Which column is which? (${rows.length} rows)</div>
    ${field('Student ID', select('bt-map-id', map.id))}
    ${field("Student's phone", select('bt-map-student', map.student))}
    ${field("Parent's phone", select('bt-map-parent', map.parent))}
    <div style="${faint}margin:8px 0;">First rows: ${sample}</div>
    <div style="display:flex;gap:8px;">
      <button class="btn-primary" onclick="window.btImportRun()">Import</button>
      <button class="btn-cancel" onclick="window.btImportCancel()">Cancel</button>
    </div>`;
}

function startMapping(text) {
  const t = parseTable(text);
  if (!t.headers.length || !t.rows.length) {
    view.imp = null;
    view.msg = 'That looks empty. Check the file or the pasted text.';
    renderImport();
    return;
  }
  view.msg = '';
  view.imp = { headers: t.headers, rows: t.rows, map: guessColumns(t.headers) };
  renderImport();
}

export async function btFile(input) {
  const f = input.files && input.files[0];
  if (f) startMapping(await f.text());
}
export function btReadPaste() { startMapping((el('bt-paste') || {}).value || ''); }

export function btImportRun() {
  const val = (id) => { const v = (el(id) || {}).value; return v === '' || v === undefined ? -1 : parseInt(v, 10); };
  const map = { id: val('bt-map-id'), student: val('bt-map-student'), parent: val('bt-map-parent') };
  if (map.id < 0) { view.msg = 'Choose the student ID column.'; renderImport(); return; }
  if (map.student < 0 && map.parent < 0) { view.msg = 'Choose at least one phone column.'; renderImport(); return; }

  const incoming = buildContacts(view.imp.rows, map);
  if (!incoming.count) { view.msg = 'No valid phone numbers were found in those columns.'; renderImport(); return; }
  const contacts = mergeContacts(loadContacts(), incoming);
  if (!saveContacts(contacts)) { view.msg = "Couldn't save the numbers in this browser."; renderImport(); return; }

  view.contacts = loadContacts();
  view.imp = null;
  view.msg = '';
  contactsLine();
  toast(`${contacts.added} added, ${contacts.updated} updated` + (contacts.bad.length ? `, ${contacts.bad.length} skipped (bad number)` : ''));
  if (view.rows) render(); else load();
}

export function btImportCancel() {
  view.imp = null;
  view.msg = '';
  if (view.rows) render(); else load();
}

export function btClearNumbers() {
  if (!window.confirm('Remove the phone numbers saved in this browser?')) return;
  clearContacts();
  view.contacts = null;
  contactsLine();
  if (view.mode === 'list' && view.rows) render();
}

// ------------------------------------------------------------------ controls
export function btSubject(subject) { view.subject = subject; view.group = 'all'; render(); sheetCheckStatus(); }
export function btGroup(key) { view.group = key; render(); }
export async function btRefresh() { sheetCheckStatus(); await load(); }

window.openBlankTracker = openBlankTracker;
window.btSubject = btSubject;
window.btGroup = btGroup;
window.btRefresh = btRefresh;
window.btMark = btMark;
window.btUndo = btUndo;
window.btImport = btImport;
window.btFile = btFile;
window.btReadPaste = btReadPaste;
window.btImportRun = btImportRun;
window.btImportCancel = btImportCancel;
window.btClearNumbers = btClearNumbers;

// ------------------------------------------------------------------ the button next to "Missed lessons"
// The new button is a copy of the Missed lessons one, so it looks the same. If that button can't be found,
// a plain one is added, or you can put this in index.html yourself:
//   <button class="btn-cancel" onclick="openBlankTracker()">Blank files</button>
function addButton() {
  const tools = document.getElementById('admin-tools');
  if (!tools) return false;
  if (tools.querySelector('[data-blank-btn]')) return true;
  const src = tools.querySelector('[onclick*="openMissedTracker"]');
  let btn;
  if (src) {
    btn = src.cloneNode(true);
    btn.removeAttribute('id');
    btn.innerHTML = src.innerHTML
      .replace(/Missed\s*lessons?/i, 'Blank files')
      .replace(/ti-[a-z0-9-]+/, 'ti-file-off');
    if (!/Blank files/.test(btn.innerHTML)) btn.innerHTML = '<i class="ti ti-file-off"></i> Blank files';
  } else {
    btn = document.createElement('button');
    btn.className = 'btn-cancel';
    btn.innerHTML = '<i class="ti ti-file-off"></i> Blank files';
  }
  btn.setAttribute('onclick', 'window.openBlankTracker()');
  btn.setAttribute('data-blank-btn', '1');
  if (src) src.insertAdjacentElement('afterend', btn); else tools.appendChild(btn);
  return true;
}
if (!addButton()) document.addEventListener('DOMContentLoaded', addButton);

// Admin tool: students who have missed 2 / 3+ lessons in a row (homework and attendance).
// Saved in the database: only the ticks ("warning sent" / "parents contacted"), shared by all admins.
// Kept in this browser only: the phone numbers used by the WhatsApp buttons.
import { db, esc, toast } from './config.js';
import {
  collection, getDocs, getDoc, doc, query, where, setDoc, deleteField, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { state } from './auth.js';
import { openModal } from './modal.js';
import { computeStreaks, subjectsOf } from './streaks.js';
import { GROUPS, usesGroups } from './groups.js';
import {
  parseTable, guessColumns, buildContacts, lookupContact, waLink,
  loadContacts, saveContacts, clearContacts, mergeContacts
} from './contacts.js';

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1Q6Wm47K9buwjh56WVTk8mGEkNqpCkC_WrXe5my1Sr_s/edit?usp=sharing';
const SUBJECTS = { olcam: 'Cambridge', oledx: 'Edexcel' };

// The WhatsApp messages. Change the wording here if you like.
// The assistant's name is taken from the email they logged in with (farah@gmail.com -> Farah).
// *Name* is shown in bold by WhatsApp.
const times = (n) => (n === 2 ? 'twice' : n === 3 ? 'three times' : `${n} times`);
const INTRO = (me) => `Hello, I’m *${me}*, Mr. Boules’s assistant.`;
const THANKS = 'Thank you for your cooperation.';
const MESSAGE = {
  student: {
    attendance: (r, me) => `${INTRO(me)} This is a warning that you have been absent from class ${times(r.count)} in a row. If you miss the next lesson, your parent will be contacted. ${THANKS}`,
    homework: (r, me) => `${INTRO(me)} This is a warning that you have not submitted the homework ${times(r.count)} in a row. If the next homework is not submitted, your parent will be contacted. ${THANKS}`,
  },
  parent: {
    homework: (r, me) => `${INTRO(me)} I would like to inform you that the homework has not been submitted ${times(r.count)} in a row. Kindly ensure that the upcoming homework is submitted on time. ${THANKS}`,
    attendance: (r, me) => `${INTRO(me)} I would like to inform you that your child has been absent from class ${times(r.count)} in a row. Kindly ensure that they attend the upcoming lessons. ${THANKS}`,
  },
};

// "farah@gmail.com" -> "Farah"
function adminName() {
  const local = String(state.userEmail || '').split('@')[0];
  const first = local.split(/[._\-+\d]+/).find(Boolean) || 'Assistant';
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

// ---- Cambridge groups ----
// Homework tab: a student's group is the one on their homework submissions; students who never submitted
// go in "Never submitted". Attendance tab: the group of the sessions they attended; students who never attended
// go in "Never attended". The two tabs do not look at each other (streaks.js sets row.tabGroup).
const GROUP_NONE = '__never__';
const normG = (g) => String(g == null ? '' : g).trim().toLowerCase();
const groupFor = (r) => normG(r.tabGroup);
const neverLabel = () => (view.tab === 'homework' ? 'Never submitted' : 'Never attended');

const FONT = "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif";
const freshView = () => ({
  subject: 'olcam', tab: 'homework', group: 'all', mode: 'list', result: null,
  acks: { homework: {}, attendance: {} }, sent: {}, msg: '', imp: null, contacts: loadContacts(),
});
let studentsCache = null;
// What the panel loaded for each subject (posts, attendance, submissions, ticks), kept for a few minutes so
// opening the panel again does not re-read everything. "Refresh" skips it, and uploading attendance clears it.
const CACHE_MS = 3 * 60 * 1000;
let dataCache = {};
let view = freshView();

const el = (id) => document.getElementById(id);

// "Lessons 1–5" instead of "Lesson 1, Lesson 2, Lesson 3, Lesson 4, Lesson 5"
function fmtLessons(run) {
  const ranges = [];
  let start = run[0], prev = run[0];
  for (let i = 1; i <= run.length; i++) {
    if (run[i] === prev + 1) { prev = run[i]; continue; }
    ranges.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = run[i]; prev = run[i];
  }
  return (run.length === 1 ? 'Lesson ' : 'Lessons ') + ranges.join(', ');
}

export async function openMissedTracker() {
  if (!state.isAdmin) return;
  view = freshView();

  // A bigger window than the normal pop-ups
  const m = document.getElementById('modal');
  m.style.width = 'min(96vw, 1000px)';
  m.style.maxWidth = 'none';
  m.style.maxHeight = '94vh';
  m.style.overflowY = 'auto';

  m.innerHTML = `
    <h2>Missed lessons</h2>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px;">
      <select id="mt-subject" onchange="window.mtSubject(this.value)">
        ${Object.entries(SUBJECTS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
      </select>
      <a class="btn-cancel" href="${SHEET_URL}" target="_blank" rel="noopener"
         style="text-decoration:none;display:inline-block;padding:8px 14px;">Open the Google Sheet ↗</a>
      <button class="btn-cancel" onclick="window.mtRefresh()">Refresh</button>
      <button class="btn-cancel" onclick="window.mtImport()"><i class="ti ti-brand-whatsapp"></i> Import numbers</button>
    </div>
    <div id="mt-contacts" style="font-size:11.5px;color:var(--paper-text-faint);margin-bottom:8px;"></div>
    <div style="font-size:12px;color:var(--paper-text-faint);margin-bottom:10px;">
      <span style="color:#b3261e;font-weight:600;">3 or more in a row: contact the parents.</span>
      &nbsp;·&nbsp;
      <span style="color:#8a6d1d;font-weight:600;">2 in a row: warn the student.</span>
      <div style="margin-top:4px;">Tick the box once you've done it. It is saved for all admins and the student leaves the list on the next refresh.
      After a warning, one more missed lesson makes them "Contact parents". After the parents are contacted, counting starts again from zero.</div>
    </div>
    <div id="mt-msg"></div>
    <div id="mt-tabs"></div>
    <div id="mt-body" style="max-height:calc(90vh - 360px);min-height:180px;overflow:auto;margin-top:8px;"></div>
    <div class="modal-footer"><button class="btn-cancel" onclick="closeModal()">Close</button></div>`;
  openModal();
  contactsLine();
  await load();
}

function contactsLine() {
  const box = el('mt-contacts');
  if (!box) return;
  const c = view.contacts;
  box.innerHTML = c
    ? `WhatsApp numbers: ${c.count} students, imported ${esc(new Date(c.at).toLocaleDateString())} (saved in this browser only).
       <a href="#" onclick="window.mtClearNumbers();return false;" style="text-decoration:underline;">Remove</a>`
    : 'No phone numbers imported yet. Use "Import numbers" to get a WhatsApp button on each student.';
}

// ------------------------------------------------------------------ data
async function loadSubmissions(subject, roster, posts) {
  try {
    const snap = await getDocs(query(collection(db, 'submissions'), where('subject', '==', subject)));
    const out = [];
    snap.forEach((d) => out.push(d.data()));
    return out;
  } catch (e) {
    console.warn('List query refused, checking students one by one', e);
    const jobs = [];
    for (const s of roster) for (const p of posts) jobs.push([String(s.email).trim().toLowerCase(), p._id]);
    const out = [];
    let i = 0;
    const worker = async () => {
      while (i < jobs.length) {
        const [email, pid] = jobs[i++];
        try {
          const snap = await getDoc(doc(db, 'submissions', `${email}_${pid}`));
          if (snap.exists()) out.push(snap.data());
        } catch (err) { /* ignore one failed read */ }
      }
    };
    await Promise.all(Array.from({ length: 20 }, worker));
    return out;
  }
}

// The ticks saved by admins (shared, one document per student per tab)
async function loadAcks(subject) {
  const acks = { homework: {}, attendance: {} };
  try {
    const snap = await getDocs(query(collection(db, 'missedAcks'), where('subject', '==', subject)));
    snap.forEach((d) => {
      const x = d.data();
      if (acks[x.type]) acks[x.type][String(x.email || '').trim().toLowerCase()] = x;
    });
    return { acks, ok: true };
  } catch (e) {
    console.warn('Could not load the ticks', e);
    return { acks, ok: false };
  }
}

async function load(force = false) {
  const body = el('mt-body');
  if (!body) return;
  view.mode = 'list';
  el('mt-tabs').innerHTML = '';
  body.innerHTML = '<div class="loading">Loading students, homework and attendance…</div>';
  const subject = view.subject;

  try {
    if (!studentsCache) {
      const snap = await getDocs(collection(db, 'students'));
      studentsCache = [];
      snap.forEach((d) => studentsCache.push(d.data()));
    }
    let data = dataCache[subject];
    if (force || !data || Date.now() - data.at > CACHE_MS) {
      const [postSnap, attSnap] = await Promise.all([
        getDocs(collection(db, `${subject}_homework`)),
        getDocs(collection(db, `${subject}_attendance`)),
      ]);
      const posts = [];
      postSnap.forEach((d) => posts.push({ _id: d.id, ...d.data() }));
      const attendance = [];
      attSnap.forEach((d) => attendance.push(d.data()));

      const roster = studentsCache.filter((s) => {
        const subs = subjectsOf(s);
        return !studentsCache.some((x) => subjectsOf(x).size) || subs.has(subject);
      });
      const submissions = await loadSubmissions(subject, roster, posts);
      const { acks, ok } = await loadAcks(subject);
      data = dataCache[subject] = { at: Date.now(), posts, attendance, submissions, acks, ackOk: ok };
    }
    const { posts, attendance, submissions, acks } = data;

    view.acks = acks;          // the same object as in the cache, so ticks made here are remembered
    view.fetchedAt = data.at;
    view.sent = {};
    view.msg = data.ackOk ? '' : "Couldn't load the ticks saved by other admins, so students already handled may still show.";
    view.result = computeStreaks({ subject, students: studentsCache, posts, submissions, attendance, acks });
    render();
  } catch (e) {
    console.error(e);
    body.innerHTML = '<div style="color:var(--rust);">Could not load the data. Check the console for details.</div>';
  }
}

// ------------------------------------------------------------------ the list
const LEVEL_STYLE = {
  contact: { label: 'Contact parents', bg: '#fdecea', fg: '#b3261e' },
  warn: { label: 'Warn student', bg: '#fff4d6', fg: '#8a6d1d' },
};

function waButton(href, label) {
  return `<a href="${esc(href)}" target="_blank" rel="noopener"
    style="display:inline-flex;align-items:center;gap:6px;text-decoration:none;font-family:${FONT};font-size:12.5px;font-weight:600;
    padding:6px 12px;border-radius:999px;background:#25D366;color:#fff;white-space:nowrap;">
    <i class="ti ti-brand-whatsapp"></i> ${esc(label)}</a>`;
}

// "Contact parents" rows get the parent's number; "Warn student" rows get the student's number
function whatsappHtml(r) {
  if (!view.contacts) return '';
  const c = lookupContact(view.contacts, r);
  const none = (what) => `<span style="font-family:${FONT};font-size:11.5px;color:#9a9288;">No ${what} number</span>`;
  const me = adminName();
  if (r.level === 'contact') {
    if (!c || !c.parent) return none('parent');
    return waButton(waLink(c.parent, MESSAGE.parent[view.tab](r, me)), 'Parent');
  }
  if (!c || !c.student) return none('student');
  return waButton(waLink(c.student, MESSAGE.student[view.tab](r, me)), 'Student');
}

function groupNote(r) {
  if (!usesGroups(view.subject) || view.group !== 'all') return '';
  const g = groupFor(r);
  if (g === GROUP_NONE) return ` · ${neverLabel()}`;
  return g ? ` · Group ${esc(g)}` : '';
}

function groupTabsHtml(rows) {
  const counts = {};
  let none = 0;
  for (const x of rows) { const g = groupFor(x); if (g === GROUP_NONE) none++; else if (g) counts[g] = (counts[g] || 0) + 1; }
  const known = GROUPS.map(normG);
  const extra = Object.keys(counts).filter((g) => !known.includes(g)).sort();
  const btn = (key, label, n) => `
    <button class="${view.group === key ? 'btn-primary' : 'btn-cancel'}" style="margin:0 6px 6px 0;padding:5px 12px;font-size:12.5px;"
      onclick="window.mtGroup('${esc(key)}')">${label} (${n})</button>`;
  return `<div style="margin-top:8px;">`
    + btn('all', 'All', rows.length)
    + GROUPS.map((g) => btn(normG(g), `Group ${esc(g)}`, counts[normG(g)] || 0)).join('')
    + extra.map((g) => btn(g, `Group ${esc(g)}`, counts[g])).join('')
    + btn(GROUP_NONE, neverLabel(), none)
    + `</div>`;
}

function rowHtml(r, idx) {
  const st = LEVEL_STYLE[r.level];
  const sent = !!view.sent[`${view.tab}|${r.email}`];
  const boxLabel = r.level === 'contact' ? 'Parents contacted' : 'Warning sent';
  return `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:12px 0;border-top:1px solid var(--paper-line,#e5e0d6);${sent ? 'opacity:.55;' : ''}">
      <div style="display:flex;gap:10px;align-items:flex-start;min-width:0;flex:1;">
        <input type="checkbox" id="mt-chk-${idx}" ${sent ? 'checked' : ''} style="margin-top:3px;width:18px;height:18px;flex:none;"
          onchange="window.mtMark(${idx}, this.checked)" />
        <div style="min-width:0;cursor:pointer;" onclick="document.getElementById('mt-chk-${idx}').click()">
          <div style="font-family:${FONT};font-weight:700;font-size:15px;color:#1f1b16;word-break:break-word;">
            ${esc(r.id || '(no id)')} · ${esc(r.email)}
          </div>
          <div style="font-size:12.5px;color:var(--paper-text-faint);margin-top:2px;">Missed ${r.count} in a row: ${esc(fmtLessons(r.run))}${groupNote(r)}</div>
          <div style="font-size:11.5px;color:var(--paper-text-faint);">${sent ? '✓ ' + boxLabel + ' (leaves the list on refresh)' : 'Tick when: ' + boxLabel.toLowerCase()}</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex:none;">
        <span style="white-space:nowrap;font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;background:${st.bg};color:${st.fg};">${st.label}</span>
        ${whatsappHtml(r)}
      </div>
    </div>`;
}

function render() {
  const r = view.result;
  if (!r) return;
  view.mode = 'list';
  const hwN = r.homework.length;
  const atN = r.attendance.length;
  const tabBtn = (key, label, n) => `
    <button class="${view.tab === key ? 'btn-primary' : 'btn-cancel'}" style="margin-right:6px;"
      onclick="window.mtTab('${key}')">${label} (${n})</button>`;
  const rows = view.tab === 'homework' ? r.homework : r.attendance;
  const grouped = usesGroups(view.subject);
  el('mt-tabs').innerHTML = tabBtn('homework', 'Homework', hwN) + tabBtn('attendance', 'Attendance', atN)
    + (grouped ? groupTabsHtml(rows) : '');

  const inGroup = (x) => !grouped || view.group === 'all'
    || groupFor(x) === view.group;
  const visible = rows.filter(inGroup);
  const contact = visible.filter((x) => x.level === 'contact');
  const warn = visible.filter((x) => x.level === 'warn');

  const notes = [];
  notes.push(`${r.meta.checked} students checked.`);
  if (r.meta.noSubject) notes.push(`${r.meta.noSubject} students have no subject set and were skipped.`);
  if (r.meta.rosterFallback) notes.push("Couldn't read a subject from the student records, so only students with homework or attendance in this subject are checked.");
  if (grouped) notes.push("Homework tab: the group is the one on the student's homework submissions. Attendance tab: the group of the sessions they attended. Students who have never submitted / never attended have their own tab.");
  if (view.tab === 'attendance') notes.push("A student whose ID didn't match when attendance was uploaded counts as absent.");
  if (view.tab === 'homework') notes.push('A lesson counts once its deadline has passed. Any group counts as a submission.');
  if (view.fetchedAt && Date.now() - view.fetchedAt > 60000) notes.push(`This list was loaded ${Math.round((Date.now() - view.fetchedAt) / 60000)} min ago. Press Refresh for the latest.`);

  const section = (title, list) => list.length
    ? `<div style="font-weight:600;font-size:13px;margin:12px 0 2px;">${title} (${list.length})</div>${list.map((x) => rowHtml(x, rows.indexOf(x))).join('')}`
    : '';

  const msgBox = el('mt-msg');
  if (msgBox) msgBox.innerHTML = view.msg ? `<div style="background:#fdecea;color:#b3261e;padding:8px 12px;border-radius:8px;font-size:12.5px;margin-bottom:8px;">${esc(view.msg)}</div>` : '';

  el('mt-body').innerHTML =
    (visible.length
      ? section('Contact the parents', contact) + section('Warn the student', warn)
      : `<div style="font-size:13px;padding:10px 0;">Nobody ${rows.length ? 'in this group ' : ''}has missed 2 or more in a row.</div>`) +
    `<div style="font-size:11.5px;color:var(--paper-text-faint);margin-top:14px;">${notes.join(' ')}</div>`;
}

// Tick / untick: saved for every admin. The row stays (dimmed) until the next refresh.
export async function mtMark(idx, checked) {
  const rows = view.tab === 'homework' ? view.result.homework : view.result.attendance;
  const r = rows[idx];
  if (!r) return;
  const key = `${view.tab}|${r.email}`;
  const field = r.level === 'contact' ? 'contactedThrough' : 'warnedThrough';
  const ref = doc(db, 'missedAcks', `${view.subject}_${view.tab}_${r.email}`);
  const who = state.userEmail || 'admin';
  const box = el(`mt-chk-${idx}`);
  if (box) box.disabled = true;
  try {
    if (checked) {
      const prev = ((view.acks[view.tab] || {})[r.email] || {})[field];     // so unticking can restore it
      await setDoc(ref, {
        subject: view.subject, type: view.tab, email: r.email,
        [field]: r.last, lastAction: r.level, updatedBy: who, updatedAt: serverTimestamp(),
      }, { merge: true });
      view.sent[key] = { field, prev };
    } else {
      const s = view.sent[key];
      view.lastUntick = s;
      await setDoc(ref, {
        [field]: s && s.prev != null ? s.prev : deleteField(),
        updatedBy: who, updatedAt: serverTimestamp(),
      }, { merge: true });
      delete view.sent[key];
    }
    // keep the cached ticks in step, so opening the panel again does not show this student again
    const a = (view.acks[view.tab] = view.acks[view.tab] || {});
    const cur = (a[r.email] = a[r.email] || {});
    if (checked) cur[field] = r.last;
    else { const s0 = view.lastUntick; if (s0 && s0.prev != null) cur[field] = s0.prev; else delete cur[field]; }
    view.msg = '';
  } catch (e) {
    console.error(e);
    view.msg = "Couldn't save that tick (check your Firestore rules for the missedAcks collection). Nothing was changed.";
  }
  render();
}

// ------------------------------------------------------------------ importing phone numbers
export function mtImport() {
  view.mode = 'import';
  view.imp = null;
  view.msg = '';
  renderImport();
}

function renderImport() {
  el('mt-tabs').innerHTML = '';
  const msgBox = el('mt-msg');
  if (msgBox) msgBox.innerHTML = view.msg ? `<div style="background:#fdecea;color:#b3261e;padding:8px 12px;border-radius:8px;font-size:12.5px;margin-bottom:8px;">${esc(view.msg)}</div>` : '';
  const body = el('mt-body');
  const faint = 'font-size:12.5px;color:var(--paper-text-faint);';

  if (!view.imp) {
    body.innerHTML = `
      <div style="font-weight:600;margin-bottom:6px;">Import phone numbers</div>
      <div style="${faint}margin-bottom:10px;line-height:1.5;">
        In your Google Sheet: <b>File → Download → Comma-separated values (.csv)</b>, then choose that file below,
        or copy the table and paste it. It needs three columns: the <b>student ID</b>, the <b>student's phone</b> and the <b>parent's phone</b>.
        Egyptian numbers like 01012345678 are fixed up automatically.
        Importing <b>adds</b> new students and <b>updates</b> the ones in the file. Students who are not in the file keep their saved numbers.
      </div>
      <input type="file" id="mt-file" accept=".csv,.tsv,.txt,text/csv" onchange="window.mtFile(this)" />
      <textarea id="mt-paste" rows="5" style="margin-top:10px;width:100%;" placeholder="…or paste the table here"></textarea>
      <div style="margin-top:10px;display:flex;gap:8px;">
        <button class="btn-primary" onclick="window.mtReadPaste()">Read table</button>
        <button class="btn-cancel" onclick="window.mtImportCancel()">Cancel</button>
      </div>
      <div style="${faint}margin-top:12px;line-height:1.5;">
        Privacy: the numbers are saved only in this browser, not in the database. Each assistant imports the same file once on their own device.
      </div>`;
    return;
  }

  const { headers, rows, map } = view.imp;
  const select = (id, current, allowNone = true) => `
    <select id="${id}">
      ${allowNone ? '<option value="">(none)</option>' : ''}
      ${headers.map((h, i) => `<option value="${i}" ${current === i ? 'selected' : ''}>${esc(h || `Column ${i + 1}`)}</option>`).join('')}
    </select>`;
  const field = (label, html) => `<div style="margin-bottom:8px;"><div style="${faint}">${label}</div>${html}</div>`;
  const sample = rows.slice(0, 3).map((r) => `<div>${esc(r.slice(0, 6).join('  |  '))}</div>`).join('');

  body.innerHTML = `
    <div style="font-weight:600;margin-bottom:6px;">Which column is which? (${rows.length} rows)</div>
    ${field('Student ID', select('mt-map-id', map.id))}
    ${field("Student's phone", select('mt-map-student', map.student))}
    ${field("Parent's phone", select('mt-map-parent', map.parent))}
    <div style="${faint}margin:8px 0;">First rows: ${sample}</div>
    <div style="display:flex;gap:8px;">
      <button class="btn-primary" onclick="window.mtImportRun()">Import</button>
      <button class="btn-cancel" onclick="window.mtImportCancel()">Cancel</button>
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

export async function mtFile(input) {
  const f = input.files && input.files[0];
  if (f) startMapping(await f.text());
}
export function mtReadPaste() { startMapping((el('mt-paste') || {}).value || ''); }

export function mtImportRun() {
  const val = (id) => { const v = (el(id) || {}).value; return v === '' || v === undefined ? -1 : parseInt(v, 10); };
  const map = { id: val('mt-map-id'), student: val('mt-map-student'), parent: val('mt-map-parent') };
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
  if (view.result) render(); else load();
}

export function mtImportCancel() {
  view.imp = null;
  view.msg = '';
  if (view.result) render(); else load();
}

export function mtClearNumbers() {
  if (!window.confirm('Remove the phone numbers saved in this browser?')) return;
  clearContacts();
  view.contacts = null;
  contactsLine();
  if (view.mode === 'list' && view.result) render();
}

// ------------------------------------------------------------------ controls
export async function mtSubject(subject) { view.subject = subject; view.group = 'all'; await load(); }
export function mtGroup(key) { view.group = key; render(); }
export function mtTab(tab) { view.tab = tab; render(); }
export async function mtRefresh() { studentsCache = null; dataCache = {}; await load(true); }
export function mtInvalidate() { dataCache = {}; }

window.openMissedTracker = openMissedTracker;
window.mtSubject = mtSubject;
window.mtTab = mtTab;
window.mtGroup = mtGroup;
window.mtRefresh = mtRefresh;
window.mtInvalidate = mtInvalidate;
window.mtMark = mtMark;
window.mtImport = mtImport;
window.mtFile = mtFile;
window.mtReadPaste = mtReadPaste;
window.mtImportRun = mtImportRun;
window.mtImportCancel = mtImportCancel;
window.mtClearNumbers = mtClearNumbers;

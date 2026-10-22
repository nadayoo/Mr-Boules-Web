// Admin tool: students who have missed 2 / 3+ lessons in a row (homework and attendance).
// Read-only: it never writes anything.
import { db, esc } from './config.js';
import {
  collection, getDocs, getDoc, doc, query, where, setDoc, deleteField, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { state } from './auth.js';
import { openModal } from './modal.js';
import { computeStreaks, subjectsOf } from './streaks.js';

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1Q6Wm47K9buwjh56WVTk8mGEkNqpCkC_WrXe5my1Sr_s/edit?usp=sharing';
const SUBJECTS = { olcam: 'Cambridge', oledx: 'Edexcel' };

let studentsCache = null;
let view = { subject: 'olcam', tab: 'homework', result: null, acks: { homework: {}, attendance: {} }, sent: {}, msg: '' };

const el = (id) => document.getElementById(id);

export async function openMissedTracker() {
  if (!state.isAdmin) return;
  view = { subject: 'olcam', tab: 'homework', result: null, acks: { homework: {}, attendance: {} }, sent: {}, msg: '' };

  document.getElementById('modal').innerHTML = `
    <h2>Missed lessons <span>— admins only</span></h2>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px;">
      <select id="mt-subject" onchange="window.mtSubject(this.value)">
        ${Object.entries(SUBJECTS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
      </select>
      <a class="btn-cancel" href="${SHEET_URL}" target="_blank" rel="noopener"
         style="text-decoration:none;display:inline-block;padding:8px 14px;">Open the Google Sheet ↗</a>
      <button class="btn-cancel" onclick="window.mtRefresh()">Refresh</button>
    </div>
    <div style="font-size:12px;color:var(--paper-text-faint);margin-bottom:10px;">
      <span style="color:#b3261e;font-weight:600;">3 or more in a row: contact the parents.</span>
      &nbsp;·&nbsp;
      <span style="color:#8a6d1d;font-weight:600;">2 in a row: warn the student.</span>
      <div style="margin-top:4px;">Tick the box once you've done it. It is saved for all admins and the student leaves the list on the next refresh.
      After a warning, one more missed lesson makes them "Contact parents". After the parents are contacted, counting starts again from zero.</div>
    </div>
    <div id="mt-msg"></div>
    <div id="mt-tabs"></div>
    <div id="mt-body" style="max-height:52vh;overflow:auto;margin-top:8px;"></div>
    <div class="modal-footer"><button class="btn-cancel" onclick="closeModal()">Close</button></div>`;
  openModal();
  await load();
}

// Submissions of a subject. Tries one query; if the database rules refuse it, checks one by one.
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

async function load() {
  const body = el('mt-body');
  if (!body) return;
  el('mt-tabs').innerHTML = '';
  body.innerHTML = '<div class="loading">Loading students, homework and attendance…</div>';
  const subject = view.subject;

  try {
    if (!studentsCache) {
      const snap = await getDocs(collection(db, 'students'));
      studentsCache = [];
      snap.forEach((d) => studentsCache.push(d.data()));
    }
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

    view.acks = acks;
    view.sent = {};
    view.msg = ok ? '' : "Couldn't load the ticks saved by other admins, so students already handled may still show.";
    view.result = computeStreaks({ subject, students: studentsCache, posts, submissions, attendance, acks });
    render();
  } catch (e) {
    console.error(e);
    body.innerHTML = '<div style="color:var(--rust);">Could not load the data. Check the console for details.</div>';
  }
}

const LEVEL_STYLE = {
  contact: { label: 'Contact parents', bg: '#fdecea', fg: '#b3261e' },
  warn: { label: 'Warn student', bg: '#fff4d6', fg: '#8a6d1d' },
};

function rowHtml(r, idx) {
  const st = LEVEL_STYLE[r.level];
  const sent = !!view.sent[`${view.tab}|${r.email}`];
  const boxLabel = r.level === 'contact' ? 'Parents contacted' : 'Warning sent';
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--paper-line,#e5e0d6);${sent ? 'opacity:.55;' : ''}">
      <label style="display:flex;align-items:flex-start;gap:10px;margin:0;text-transform:none;cursor:pointer;">
        <input type="checkbox" id="mt-chk-${idx}" ${sent ? 'checked' : ''} style="margin-top:3px;"
          onchange="window.mtMark(${idx}, this.checked)" />
        <span>
          <strong>${esc(r.id || '(no id)')}</strong> · ${esc(r.email)}
          <div style="font-size:12px;color:var(--paper-text-faint);">
            Missed ${r.count} in a row: ${r.run.map((l) => 'Lesson ' + esc(l)).join(', ')}
          </div>
          <div style="font-size:11.5px;color:var(--paper-text-faint);">${sent ? '✓ ' + boxLabel + ' (leaves the list on refresh)' : 'Tick when: ' + boxLabel.toLowerCase()}</div>
        </span>
      </label>
      <span style="white-space:nowrap;font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;background:${st.bg};color:${st.fg};">${st.label}</span>
    </div>`;
}

function render() {
  const r = view.result;
  if (!r) return;
  const hwN = r.homework.length;
  const atN = r.attendance.length;
  const tabBtn = (key, label, n) => `
    <button class="${view.tab === key ? 'btn-primary' : 'btn-cancel'}" style="margin-right:6px;"
      onclick="window.mtTab('${key}')">${label} (${n})</button>`;
  el('mt-tabs').innerHTML = tabBtn('homework', 'Homework', hwN) + tabBtn('attendance', 'Attendance', atN);

  const rows = view.tab === 'homework' ? r.homework : r.attendance;
  const contact = rows.filter((x) => x.level === 'contact');
  const warn = rows.filter((x) => x.level === 'warn');

  const notes = [];
  notes.push(`${r.meta.checked} students checked.`);
  if (r.meta.noSubject) notes.push(`${r.meta.noSubject} students have no subject set and were skipped.`);
  if (r.meta.rosterFallback) notes.push("Couldn't read a subject from the student records, so only students with homework or attendance in this subject are checked.");
  if (view.tab === 'attendance') notes.push("A student whose ID didn't match when attendance was uploaded counts as absent.");
  if (view.tab === 'homework') notes.push('A lesson counts once its deadline has passed. Any group counts as a submission.');

  const section = (title, list) => list.length
    ? `<div style="font-weight:600;font-size:13px;margin:12px 0 2px;">${title} (${list.length})</div>${list.map((r) => rowHtml(r, rows.indexOf(r))).join('')}`
    : '';

  const msgBox = el('mt-msg');
  if (msgBox) msgBox.innerHTML = view.msg ? `<div style="background:#fdecea;color:#b3261e;padding:8px 12px;border-radius:8px;font-size:12.5px;margin-bottom:8px;">${esc(view.msg)}</div>` : '';

  el('mt-body').innerHTML =
    (rows.length
      ? section('Contact the parents', contact) + section('Warn the student', warn)
      : '<div style="font-size:13px;padding:10px 0;">Nobody has missed 2 or more in a row.</div>') +
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
      await setDoc(ref, {
        [field]: s && s.prev != null ? s.prev : deleteField(),
        updatedBy: who, updatedAt: serverTimestamp(),
      }, { merge: true });
      delete view.sent[key];
    }
    view.msg = '';
  } catch (e) {
    console.error(e);
    view.msg = "Couldn't save that tick (check your Firestore rules for the missedAcks collection). Nothing was changed.";
  }
  render();
}

export async function mtSubject(subject) { view.subject = subject; await load(); }
export function mtTab(tab) { view.tab = tab; render(); }
export async function mtRefresh() { studentsCache = null; await load(); }

window.openMissedTracker = openMissedTracker;
window.mtSubject = mtSubject;
window.mtTab = mtTab;
window.mtRefresh = mtRefresh;
window.mtMark = mtMark;

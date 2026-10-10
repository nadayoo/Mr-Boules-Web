// Admin tool: fix a student who submitted into the wrong group.
//
// The group a student sees is worked out from their submission records. This tool changes the
// `group` on those records (an update only: nothing is created or deleted, so the Google Sheet
// function, which only runs when a record is first created, is not triggered). The deadline does
// not matter because this is an admin edit. The student then sees their group's card with
// "You already submitted this homework".
import { db, toast, esc } from './config.js';
import {
  collection, getDocs, getDoc, doc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { state } from './auth.js';
import { openModal, closeModal } from './modal.js';
import { GROUPS, lessonOf, groupOf, inferGroup, planGroupSwitch } from './groups.js';

const SUBJECT = 'olcam';       // only Cambridge uses groups

let students = [];             // { id, email }
let posts = [];                // homework posts
let lastHits = [];
let current = null;            // { student, subs: [{ postId, data }] }
let plan = null;

const el = (id) => document.getElementById(id);
const folderGroupOf = (path) => {
  const m = String(path || '').match(/\/group-([^/]+)\//);
  return m ? m[1].toLowerCase() : '';
};

export async function openGroupFixer() {
  if (!state.isAdmin) return;
  current = null;
  plan = null;
  lastHits = [];

  document.getElementById('modal').innerHTML = `
    <h2>Fix student group <span>— Cambridge</span></h2>
    <label>Search by student ID or email</label>
    <input type="text" id="gf-search" placeholder="e.g. A0A56" oninput="window.gfSearch()" autocomplete="off" />
    <div id="gf-results" style="margin-top:8px;"></div>
    <div id="gf-detail" style="margin-top:14px;max-height:50vh;overflow:auto;"></div>
    <div class="modal-footer">
      <button class="btn-cancel" onclick="closeModal()">Close</button>
    </div>`;
  openModal();
  el('gf-results').innerHTML = '<div class="loading">Loading students…</div>';

  try {
    const [stuSnap, postSnap] = await Promise.all([
      getDocs(collection(db, 'students')),
      getDocs(collection(db, `${SUBJECT}_homework`)),
    ]);
    students = [];
    stuSnap.forEach((d) => {
      const x = d.data();
      const email = String(x.email || '').trim().toLowerCase();
      if (email) students.push({ id: String(x.id || '').trim(), email });
    });
    posts = [];
    postSnap.forEach((d) => posts.push({ _id: d.id, ...d.data() }));
    el('gf-results').innerHTML = `<div style="font-size:12px;color:var(--paper-text-faint);">${students.length} students loaded. Start typing an ID or email.</div>`;
    el('gf-search').focus();
  } catch (e) {
    console.error(e);
    el('gf-results').innerHTML = '<div style="color:var(--rust);">Could not load students.</div>';
  }
}

export function gfSearch() {
  const q = (el('gf-search')?.value || '').trim();
  const box = el('gf-results');
  if (!q) { box.innerHTML = ''; return; }
  const up = q.toUpperCase();
  const low = q.toLowerCase();
  lastHits = students.filter((s) => s.id.toUpperCase().includes(up) || s.email.includes(low)).slice(0, 8);
  box.innerHTML = lastHits.length
    ? lastHits.map((s, i) => `
        <button class="btn-cancel" style="display:block;width:100%;text-align:left;margin-bottom:6px;"
          onclick="window.gfSelect(${i})"><strong>${esc(s.id || '(no id)')}</strong> &nbsp; ${esc(s.email)}</button>`).join('')
    : '<div style="font-size:13px;color:var(--paper-text-faint);">No student found.</div>';
}

export async function gfSelect(i) {
  const student = lastHits[i];
  if (!student) return;
  el('gf-results').innerHTML = '';
  el('gf-search').value = student.id || student.email;
  await loadStudent(student);
}

async function loadStudent(student) {
  const box = el('gf-detail');
  box.innerHTML = '<div class="loading">Loading submissions…</div>';
  plan = null;
  try {
    const subs = [];
    await Promise.all(posts.map(async (p) => {
      const snap = await getDoc(doc(db, 'submissions', `${student.email}_${p._id}`));
      if (snap.exists()) subs.push({ postId: p._id, data: snap.data() });
    }));
    subs.sort((a, b) => (lessonOf(posts.find((p) => p._id === a.postId) || {}) || 0) -
                        (lessonOf(posts.find((p) => p._id === b.postId) || {}) || 0));
    current = { student, subs };
    renderDetail();
  } catch (e) {
    console.error(e);
    box.innerHTML = '<div style="color:var(--rust);">Could not load this student\'s submissions.</div>';
  }
}

function renderDetail(note = '') {
  const box = el('gf-detail');
  const { student, subs } = current;

  // What the site currently treats this student as
  const newestFirst = [...posts].sort((a, b) => (lessonOf(b) || 0) - (lessonOf(a) || 0));
  const map = {};
  subs.forEach((s) => { map[s.postId] = s.data; });
  const siteGroup = inferGroup(newestFirst, map);

  let html = `
    <div style="font-size:13px;margin-bottom:10px;">
      <strong>${esc(student.id || '(no id)')}</strong> · ${esc(student.email)}<br>
      The site currently shows this student: <strong>${siteGroup ? 'Group ' + esc(siteGroup) : 'no group yet'}</strong>
    </div>
    ${note ? `<div style="background:var(--chalk-teal-dim);padding:10px 12px;border-radius:8px;font-size:12.5px;margin-bottom:10px;">${note}</div>` : ''}`;

  if (!subs.length) {
    html += `<div style="font-size:13px;color:var(--paper-text-faint);">No submissions yet, so nothing to change here.
      If they picked the wrong group, they can use the small "change" link next to the group badge on their homework card.</div>`;
    box.innerHTML = html;
    return;
  }

  html += `<table style="width:100%;font-size:12.5px;border-collapse:collapse;">
    <tr style="text-align:left;color:var(--paper-text-faint);"><th>Lesson</th><th>Group</th><th>File</th><th>Folder</th></tr>
    ${subs.map((s) => {
      const post = posts.find((p) => p._id === s.postId) || { title: s.data.homeworkTitle };
      const g = (s.data.group ? String(s.data.group).toLowerCase() : '') || groupOf(post);
      const fg = folderGroupOf(s.data.path);
      const ok = fg === g;
      return `<tr style="border-top:1px solid var(--paper-line, #ddd);">
        <td>${esc(lessonOf(post) ?? '?')}</td>
        <td>Group ${esc(g || '?')}</td>
        <td>${s.data.url ? `<a href="${esc(s.data.url)}" target="_blank" rel="noopener">view</a>` : '—'}</td>
        <td>${ok ? 'ok' : `<span style="color:var(--rust);">${fg ? 'group-' + esc(fg) : 'flat'}</span>`}</td></tr>`;
    }).join('')}
  </table>

  <div style="margin-top:14px;">
    <label>Move this student to</label>
    <select id="gf-target">${GROUPS.map((g) => `<option value="${g}">Group ${g}</option>`).join('')}</select>
    <button class="btn-primary" style="margin-top:8px;" onclick="window.gfPreview()">Preview changes</button>
  </div>
  <div id="gf-plan" style="margin-top:12px;"></div>`;
  box.innerHTML = html;
}

export function gfPreview() {
  if (!current) return;
  const target = el('gf-target').value;
  plan = planGroupSwitch(posts, current.subs, target);
  const box = el('gf-plan');

  if (!plan.changes.length) {
    box.innerHTML = `<div style="font-size:13px;">Nothing to change: every submission is already in Group ${esc(target)}.</div>`;
    return;
  }
  box.innerHTML = `
    <div style="font-size:13px;margin-bottom:6px;"><strong>${plan.changes.length}</strong> submission(s) will be switched to Group ${esc(target)}:</div>
    <ul style="font-size:12.5px;margin:0 0 10px 18px;">
      ${plan.changes.map((c) => `<li>Lesson ${esc(c.lesson ?? '?')}: Group ${esc(c.from || '?')} → Group ${esc(c.to)}
        ${c.hasTargetPost ? '' : '<em>(Group ' + esc(c.to) + ' has no post for this lesson yet; it will show once posted)</em>'}</li>`).join('')}
    </ul>
    <button class="btn-primary" onclick="window.gfApply()">Apply</button>`;
}

export async function gfApply() {
  if (!current || !plan || !plan.changes.length || !state.isAdmin) return;
  const { student } = current;
  const target = plan.changes[0].to;
  if (!window.confirm(`Switch ${plan.changes.length} submission(s) of ${student.email} to Group ${target}?`)) return;

  let ok = 0, failed = 0;
  for (const c of plan.changes) {
    try {
      await updateDoc(doc(db, 'submissions', `${student.email}_${c.postId}`), {
        group: c.to,
        homeworkTitle: c.newTitle,
        movedFromGroup: c.from,
        movedAt: serverTimestamp(),
        movedBy: state.userEmail || 'admin',
      });
      ok++;
    } catch (e) {
      console.error('Could not update', c.postId, e);
      failed++;
    }
  }
  toast(failed ? `Switched ${ok}, ${failed} failed` : `Switched ${ok} submission(s) to Group ${target}`,
        failed ? 'ti-alert-triangle' : undefined);

  await loadStudent(student);
  renderDetail(
    (failed ? `${failed} record(s) could not be changed (check your Firestore rules). ` : '') +
    `Done. The student sees Group ${esc(target)} after refreshing. Files still in the old folder are marked in red above; ` +
    `to move them run: <code>node functions/move-submissions.js --subject olcam --reconcile</code> (dry run first).`
  );
}

window.openGroupFixer = openGroupFixer;
window.gfSearch = gfSearch;
window.gfSelect = gfSelect;
window.gfPreview = gfPreview;
window.gfApply = gfApply;

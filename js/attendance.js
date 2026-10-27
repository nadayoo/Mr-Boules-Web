import { db, toast, esc } from './config.js';
import {
  collection,
  addDoc,
  getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { closeModal } from './modal.js';

// Attendance upload. Whichever subject tab you upload from, each student is saved under THEIR OWN
// subject(s): Cambridge students in Cambridge attendance, Edexcel students in Edexcel attendance.
// You see a summary first and confirm before anything is saved.

const SUBJECT_LABEL = { olcam: 'Cambridge', oledx: 'Edexcel' };
const TRACKED = ['olcam', 'oledx'];

let pending = null;      // the upload waiting for "Save"

// First column of each line, quotes removed, header row skipped, duplicates removed
export function parseIds(rawText) {
  const seen = new Set();
  const out = [];
  for (const line of String(rawText || '').split(/\r?\n/)) {
    const id = line.split(',')[0].replace(/^["'\s]+|["'\s]+$/g, '').trim();
    if (!id) continue;
    if (/^(student\s*)?id$/i.test(id)) continue;
    const key = id.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}

// Sorts the CSV IDs into Cambridge / Edexcel by each student's own subjects
export function buildPlan(ids, students, subject = null, countBoth = true) {
  const byId = {};
  for (const s of students) {
    const id = String(s.id || '').trim().toUpperCase();
    const email = String(s.email || '').trim().toLowerCase();
    if (!id || !email) continue;
    const subjects = new Set((Array.isArray(s.subjects) ? s.subjects : []).map((x) => String(x).toLowerCase()));
    byId[id] = { id, email, subjects };
  }
  const buckets = { olcam: { emails: [], ids: [] }, oledx: { emails: [], ids: [] } };
  const unlinked = [];
  const other = [];
  let bothCount = 0;          // students who are in BOTH Cambridge and Edexcel
  let otherOnly = 0;          // students who are ONLY in the other subject (a sign of a merged lesson)
  for (const raw of ids) {
    const st = byId[raw.toUpperCase()];
    if (!st) { unlinked.push(raw.toUpperCase()); continue; }
    const mine = TRACKED.filter((sub) => st.subjects.has(sub));
    if (!mine.length) { other.push({ id: st.id, email: st.email }); continue; }
    if (mine.length === 2) bothCount++;
    if (subject && mine.length === 1 && mine[0] !== subject) otherOnly++;
    // A student in both subjects is only counted in BOTH tabs for a merged lesson.
    // For a one-subject lesson they stay in the tab you uploaded from, so the other subject
    // does not get a lesson record it never had.
    const targets = mine.length === 2 && subject && !countBoth ? [subject] : mine;
    for (const sub of targets) { buckets[sub].emails.push(st.email); buckets[sub].ids.push(st.id); }
  }
  return { buckets, unlinked, other, bothCount, otherOnly };
}

const list = (arr, n = 40) => esc(arr.slice(0, n).join(', ')) + (arr.length > n ? ` … and ${arr.length - n} more` : '');

function summaryHtml(p, saved) {
  const { plan, subject } = p;
  const cam = plan.buckets.olcam, edx = plan.buckets.oledx;
  const here = plan.buckets[subject];
  const otherSub = TRACKED.find((s) => s !== subject);
  const there = plan.buckets[otherSub];
  const bothCount = plan.bothCount || 0;
  const row = (title, color, body) => `
    <div style="border-left:3px solid ${color};padding:6px 12px;margin:10px 0;font-size:13px;line-height:1.5;">
      <div style="font-weight:600;">${title}</div>${body}
    </div>`;
  const ids = (arr) => `<div style="font-size:12px;color:var(--paper-text-faint);word-break:break-word;">${list(arr)}</div>`;

  let html = `<h2>${saved ? 'Attendance saved' : 'Check before saving'} <span>— ${esc(p.title)}</span></h2>`;
  if (here.emails.length) html += row(`${SUBJECT_LABEL[subject]}: ${here.emails.length} students`, '#2e7d32', ids(here.ids));
  else html += row(`${SUBJECT_LABEL[subject]}: none`, '#9a9288', `<div style="font-size:12px;color:var(--paper-text-faint);">None of these students are in ${SUBJECT_LABEL[subject]}.</div>`);
  if (there.emails.length) {
    html += row(`${SUBJECT_LABEL[otherSub]}: ${there.emails.length} students`, '#1565c0',
      `<div>These are ${SUBJECT_LABEL[otherSub]} students. They ${saved ? 'were' : 'will be'} saved to <b>${SUBJECT_LABEL[otherSub]} attendance</b>, not ${SUBJECT_LABEL[subject]}.</div>${ids(there.ids)}`);
  }
  if (bothCount) {
    html += saved
      ? `<div style="font-size:12.5px;margin:6px 0;">${bothCount} student(s) are in both subjects and ${p.countBoth ? 'were counted in both' : `were counted in ${SUBJECT_LABEL[subject]} only`}.</div>`
      : `<label style="display:flex;gap:8px;align-items:flex-start;font-size:12.5px;margin:8px 0;cursor:pointer;">
           <input type="checkbox" id="att-both" ${p.countBoth ? 'checked' : ''} onchange="window.toggleBothAttendance(this.checked)" style="margin-top:2px;" />
           <span><b>Merged lesson</b> (Cambridge + Edexcel together): also count the ${bothCount} student(s) who are in both subjects in
           ${SUBJECT_LABEL[otherSub]}. Leave it unticked for a ${SUBJECT_LABEL[subject]}-only lesson.</span>
         </label>`;
  }
  if (plan.other.length) {
    html += row(`Not saved: ${plan.other.length} students are in neither Cambridge nor Edexcel`, '#b3261e', ids(plan.other.map((o) => o.id)));
  }
  if (plan.unlinked.length) {
    html += row(`${plan.unlinked.length} IDs didn't match any student`, '#8a6d1d', ids(plan.unlinked));
  }
  return html;
}

// Any subject other than Cambridge / Edexcel keeps the ORIGINAL behaviour: every ID in the file is saved
// straight into that subject's own attendance, with no sorting and no preview.
async function legacyUpload(subject, sessionTitle, sessionDate, file, btn) {
  btn.disabled = true;
  btn.textContent = 'Processing…';
  try {
    const validIds = (await file.text()).split(/\r?\n/).map((id) => id.trim()).filter((id) => id.length > 0);
    if (validIds.length === 0) {
      toast('CSV file is empty or invalid', 'ti-alert-triangle');
      btn.disabled = false;
      btn.textContent = 'Upload';
      return;
    }
    const studentsSnap = await getDocs(collection(db, 'students'));
    const idToEmailMap = {};
    studentsSnap.forEach((docSnap) => {
      const data = docSnap.data();
      if (data.id && data.email) idToEmailMap[data.id.trim().toUpperCase()] = data.email.trim().toLowerCase();
    });
    const presentEmails = [];
    const unlinkedIds = [];
    validIds.forEach((id) => {
      const cleanId = id.toUpperCase();
      if (idToEmailMap[cleanId]) presentEmails.push(idToEmailMap[cleanId]);
      else unlinkedIds.push(cleanId);
    });
    await addDoc(collection(db, `${subject}_attendance`), {
      title: sessionTitle, date: sessionDate, subject, presentIds: validIds, presentEmails, unlinkedIds,
      createdAt: serverTimestamp()
    });
    closeModal();
    toast(`Attendance uploaded (${presentEmails.length} students matched)`);
  } catch (err) {
    console.error('Attendance upload error:', err);
    toast('Failed to upload attendance', 'ti-alert-triangle');
    btn.disabled = false;
    btn.textContent = 'Upload';
  }
}

export async function handleAttendanceUpload(subject) {
  const sessionTitle = document.getElementById('att-session-name')?.value?.trim();
  const sessionDate = document.getElementById('att-date')?.value;
  const fileInput = document.getElementById('att-csv-file');
  const btn = document.getElementById('att-upload-btn');

  if (!sessionTitle) { toast('Please enter a session title', 'ti-alert-triangle'); return; }
  if (!sessionDate) { toast('Please select a date', 'ti-alert-triangle'); return; }
  if (!fileInput?.files?.[0]) { toast('Please select a CSV file', 'ti-alert-triangle'); return; }
  if (btn.disabled) return;
  if (!TRACKED.includes(subject)) return legacyUpload(subject, sessionTitle, sessionDate, fileInput.files[0], btn);

  btn.disabled = true;
  btn.textContent = 'Checking…';

  try {
    const ids = parseIds(await fileInput.files[0].text());
    if (!ids.length) {
      toast('CSV file is empty or invalid', 'ti-alert-triangle');
      btn.disabled = false;
      btn.textContent = 'Upload';
      return;
    }

    const snap = await getDocs(collection(db, 'students'));
    const students = [];
    snap.forEach((d) => students.push(d.data()));

    // It is a merged lesson if the file has students who are ONLY in the other subject
    const countBoth = buildPlan(ids, students, subject, true).otherOnly > 0;
    pending = { subject, title: sessionTitle, date: sessionDate, ids, students, countBoth, plan: buildPlan(ids, students, subject, countBoth), saving: false };
    renderSummary();
  } catch (err) {
    console.error('Attendance check error:', err);
    toast('Failed to read attendance', 'ti-alert-triangle');
    btn.disabled = false;
    btn.textContent = 'Upload';
  }
}

function renderSummary() {
  const p = pending;
  if (!p) return;
  const total = p.plan.buckets.olcam.emails.length + p.plan.buckets.oledx.emails.length;
  document.getElementById('modal').innerHTML = summaryHtml(p, false) + `
    <div class="modal-footer">
      <button class="btn-cancel" onclick="window.cancelAttendanceUpload()">Cancel</button>
      ${total ? `<button class="btn-primary" id="att-save-btn" onclick="window.confirmAttendanceSave()">Save attendance</button>` : ''}
    </div>`;
}

export function toggleBothAttendance(checked) {
  if (!pending || pending.saving) return;
  pending.countBoth = !!checked;
  pending.plan = buildPlan(pending.ids, pending.students, pending.subject, pending.countBoth);
  renderSummary();
}

export async function confirmAttendanceSave() {
  const p = pending;
  if (!p || p.saving) return;
  p.saving = true;
  const btn = document.getElementById('att-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  try {
    // The tab you uploaded from goes first, so the unmatched IDs are listed on that record
    const order = [p.subject, ...TRACKED.filter((s) => s !== p.subject)];
    const saved = [];
    let unlinkedPlaced = false;
    for (const sub of order) {
      const b = p.plan.buckets[sub];
      if (!b.emails.length) continue;
      await addDoc(collection(db, `${sub}_attendance`), {
        title: p.title,
        date: p.date,
        subject: sub,
        presentIds: b.ids,
        presentEmails: b.emails,
        unlinkedIds: unlinkedPlaced ? [] : p.plan.unlinked,
        createdAt: serverTimestamp()
      });
      unlinkedPlaced = true;
      saved.push(`${SUBJECT_LABEL[sub]} ${b.emails.length}`);
    }

    window.mtInvalidate?.();     // the Missed Lessons panel must not show a copy from before this upload
    document.getElementById('modal').innerHTML = summaryHtml(p, true) + `
      <div class="modal-footer"><button class="btn-primary" onclick="closeModal()">Done</button></div>`;
    toast(`Attendance saved: ${saved.join(', ')}`);
    pending = null;
  } catch (err) {
    console.error('Attendance save error:', err);
    toast('Failed to save attendance', 'ti-alert-triangle');
    p.saving = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Save attendance'; }
  }
}

export function cancelAttendanceUpload() {
  pending = null;
  closeModal();
}

// Bind to window object for global usage across components
window.handleAttendanceUpload = handleAttendanceUpload;
window.confirmAttendanceSave = confirmAttendanceSave;
window.cancelAttendanceUpload = cancelAttendanceUpload;
window.toggleBothAttendance = toggleBothAttendance;

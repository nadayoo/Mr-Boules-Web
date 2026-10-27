import { db, SUBJECT_META, SECTIONS, SECTION_META, toast } from './config.js';
import { collection, onSnapshot, query, orderBy, where, documentId, deleteDoc, doc, getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { state } from './auth.js';
import { RENDERERS } from './render.js';
import { openAdd } from './modal.js';
import { SCHEDULABLE, prepareList, listSignature } from './schedule.js';

export function buildHub(subjects) {
  const tabsEl   = document.getElementById('subject-tabs');
  const panelsEl = document.getElementById('subject-panels');
  tabsEl.innerHTML   = '';
  panelsEl.innerHTML = '';

  subjects.forEach((subject, idx) => {
    const meta = SUBJECT_META[subject];
    const btn = document.createElement('button');
    btn.className = `subject-tab${idx === 0 ? ' active' : ''}`;
    btn.dataset.subject = subject;
    btn.onclick = () => setSubject(subject);
    btn.innerHTML = `
      <div class="subject-tab-icon"><i class="ti ${meta.icon}"></i></div>
      <span class="subject-tab-label">${meta.label}</span>`;
    tabsEl.appendChild(btn);

    const panel = document.createElement('div');
    panel.id = 'panel-' + subject;
    panel.className = `subject-panel${idx === 0 ? ' active' : ''}`;
    panel.dataset.subjectPanel = subject;
    panel.innerHTML = buildSubjectPanel(subject);
    panelsEl.appendChild(panel);
  });
}

export function buildSubjectPanel(subject) {
  const tabsHtml = SECTIONS.map((s, i) => `
    <button class="tab ${i === 0 ? 'active' : ''}" data-subject="${subject}" data-section="${s}">
      <i class="ti ${SECTION_META[s].icon}"></i> ${SECTION_META[s].label.split(' ')[0]}
    </button>`).join('');

  const sectionsHtml = SECTIONS.map((s, i) => `
    <div class="section ${i === 0 ? 'active' : ''}" data-subject="${subject}" data-section-panel="${s}">
      <div class="section-header">
        <span class="section-title">${SECTION_META[s].label}</span>
        <button class="add-btn" onclick="openAdd('${subject}','${s}')">
          <i class="ti ti-plus"></i> ${s === 'marks' ? 'Manage' : 'Add'}
        </button>
      </div>
      <div id="list-${subject}-${s}"><div class="loading">Loading…</div></div>
    </div>`).join('');

  return `<div class="tabs">${tabsHtml}</div>${sectionsHtml}`;
}

export function setSubject(subject) {
  document.querySelectorAll('.subject-tab').forEach(t => t.classList.toggle('active', t.dataset.subject === subject));
  document.querySelectorAll('.subject-panel').forEach(p => p.classList.toggle('active', p.dataset.subjectPanel === subject));
  startSubject(subject);
}

export async function loadStudentProgress(email) {
  state.studentProgress = {};
  if (state.isAdmin) return;
  const prefix = email + '_';
  try {
    // Document ids are "<email>_<homeworkId>", so ask only for this student's rows
    // instead of downloading everyone's progress at every login.
    const q = query(collection(db, 'progress'), where(documentId(), '>=', prefix), where(documentId(), '<', prefix + '\uf8ff'));
    const snap = await getDocs(q);
    snap.forEach(d => {
      if (d.id.startsWith(prefix)) state.studentProgress[d.id.slice(prefix.length)] = true;
    });
  } catch (e) {
    console.error("Error loading progress, trying the full list", e);
    try {
      const snap = await getDocs(query(collection(db, 'progress')));
      snap.forEach(d => {
        if (d.id.startsWith(prefix)) state.studentProgress[d.id.slice(prefix.length)] = true;
      });
    } catch (e2) {
      console.error("Error loading progress", e2);
    }
  }
}

// Latest raw data per subject/section, so timed posts can appear on their own
const store = {};      // key -> { subject, section, items }
const lastSig = {};    // key -> signature of what is currently on screen
let tickTimer = null;

function refresh(key, force = false) {
  const entry = store[key];
  if (!entry) return;
  const { subject, section, items } = entry;
  const list = prepareList(section, items, state.isAdmin);
  const sig = listSignature(list);
  if (!force && sig === lastSig[key]) return;   // nothing changed, skip re-render
  lastSig[key] = sig;
  RENDERERS[section](subject, list);
}

// Admins listen to everything at once (there are only a few of them). Students only listen to the tab they
// are looking at, plus Homework (almost everyone opens it); the other tabs start the first time they are opened.
// A running listener keeps updating live, exactly as before.
const EAGER_SECTIONS = ['homework'];
let unsubs = [];
let started = {};

function listen(subject, section) {
  const key = `${subject}_${section}`;
  if (started[key]) return;
  started[key] = true;
  const q = query(collection(db, key), orderBy('createdAt', 'desc'));
  unsubs.push(onSnapshot(q, snap => {
    store[key] = {
      subject,
      section,
      items: snap.docs.map(d => ({ _id: d.id, ...d.data() }))
    };
    refresh(key, true);
  }));
}

// The tab that is showing when a subject panel opens, and the ones everybody uses
function startSubject(subject) {
  if (state.isAdmin) return;
  listen(subject, SECTIONS[0]);
  EAGER_SECTIONS.forEach(sec => { if (SECTIONS.includes(sec)) listen(subject, sec); });
}

export function startListeners() {
  // a second login in the same page must not stack listeners on top of the old ones
  unsubs.forEach(u => { try { u(); } catch (e) {} });
  unsubs = [];
  started = {};
  Object.keys(store).forEach(k => delete store[k]);
  Object.keys(lastSig).forEach(k => delete lastSig[k]);

  if (state.isAdmin) {
    state.userSubjects.forEach(subject => SECTIONS.forEach(section => listen(subject, section)));
  } else if (state.userSubjects.length) {
    startSubject(state.userSubjects[0]);
  }

  // Every 30s, check if a scheduled post has just become due
  if (!tickTimer) {
    tickTimer = setInterval(() => {
      Object.keys(store).forEach(key => {
        if (SCHEDULABLE.includes(store[key].section)) refresh(key);
      });
    }, 30000);
  }
}

export async function _del(subject, section, id) {
  if (!state.isAdmin) return;
  try {
    await deleteDoc(doc(db, `${subject}_${section}`, id));
    toast('Deleted');
  } catch (e) {
    toast('Error deleting', 'ti-alert-triangle');
  }
}

window.setSubject = setSubject;
window._del = _del;
window.openAdd = openAdd;

document.addEventListener('click', (e) => {
  const tabBtn = e.target.closest('.tab[data-section]');
  if (!tabBtn) return;
  const subject = tabBtn.dataset.subject;
  const section = tabBtn.dataset.section;
  if (!state.isAdmin) listen(subject, section);
  const panel = document.getElementById('panel-' + subject);
  panel.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  tabBtn.classList.add('active');
  panel.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  panel.querySelector(`.section[data-section-panel="${section}"]`).classList.add('active');
});
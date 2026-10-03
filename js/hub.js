import { db, SUBJECT_META, SECTIONS, SECTION_META, toast } from './config.js';
import { collection, onSnapshot, query, orderBy, deleteDoc, doc, getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
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
}

export async function loadStudentProgress(email) {
  state.studentProgress = {};
  if (state.isAdmin) return;
  try {
    const q = query(collection(db, 'progress'));
    const snap = await getDocs(q);
    snap.forEach(d => {
      if (d.id.startsWith(email + '_')) {
        const homeworkId = d.id.replace(email + '_', '');
        state.studentProgress[homeworkId] = true;
      }
    });
  } catch (e) {
    console.error("Error loading progress", e);
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

export function startListeners() {
  state.userSubjects.forEach(subject => {
    SECTIONS.forEach(section => {
      const key = `${subject}_${section}`;
      const q = query(collection(db, key), orderBy('createdAt', 'desc'));
      onSnapshot(q, snap => {
        store[key] = {
          subject,
          section,
          items: snap.docs.map(d => ({ _id: d.id, ...d.data() }))
        };
        refresh(key, true);
      });
    });
  });

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
  const panel = document.getElementById('panel-' + subject);
  panel.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  tabBtn.classList.add('active');
  panel.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  panel.querySelector(`.section[data-section-panel="${section}"]`).classList.add('active');
});
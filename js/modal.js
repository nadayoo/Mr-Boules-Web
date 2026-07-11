import { db, SUBJECT_META, SECTION_META, toast } from './config.js';
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export function openAdd(subject, section) {
  let fields = '';
  if (section === 'schedule') {
    fields = `
      <label>Day</label>
      <select id="f-day"><option>Sunday</option><option>Monday</option><option>Tuesday</option><option>Wednesday</option><option>Thursday</option><option>Friday</option><option>Saturday</option></select>
      <label>Time</label><input type="text" id="f-time" placeholder="e.g. 10:00 AM" />
      <label>Topic / Type</label><input type="text" id="f-topic" placeholder="e.g. Lecture, Office Hours" />`;
  } else {
    fields = `
      <label>Title</label><input type="text" id="f-title" placeholder="Enter title…" />
      <label>Description <span style="text-transform:none;color:var(--paper-text-faint)">(optional)</span></label><textarea id="f-desc" placeholder="Add details…"></textarea>
      <label>${section==='homework'?'Due date':'Date'}</label>
      <input type="text" id="f-date" placeholder="${section==='homework'?'e.g. Due: Jul 5':'e.g. Jun 28'}" />
      ${['recordings','notes','homework'].includes(section)?`<label>Link <span style="text-transform:none;color:var(--paper-text-faint)">(Drive / YouTube / Zoom, optional)</span></label><input type="url" id="f-link" placeholder="https://…" />`:''}
      ${section==='announcements'?`<label>Badge</label><select id="f-badge"><option value="">None</option><option value="new">New</option><option value="important">Important</option></select><label>Pin to top?</label><select id="f-pin"><option value="">No</option><option value="yes">Yes</option></select>`:''}
      ${section==='homework'?`<label>Status</label><select id="f-badge"><option value="due">Due</option><option value="done">Done</option></select>`:''}`;
  }
  const subjLabel = SUBJECT_META[subject]?.label || subject;
  document.getElementById('modal').innerHTML = `
    <h2>${SECTION_META[section].addLabel} <span>— ${subjLabel}</span></h2>${fields}
    <div class="modal-footer">
      <button class="btn-cancel" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" id="submit-btn" onclick="submitAdd('${subject}','${section}')">Add</button>
    </div>`;
  openModal();
}

export async function submitAdd(subject, section) {
  const btn = document.getElementById('submit-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    let data = { createdAt: serverTimestamp() };
    if (section === 'schedule') {
      data.day   = document.getElementById('f-day').value;
      data.time  = document.getElementById('f-time').value || '—';
      data.topic = document.getElementById('f-topic').value || 'Class';
    } else {
      const title = document.getElementById('f-title')?.value?.trim();
      if (!title) { document.getElementById('f-title').focus(); btn.disabled=false; btn.textContent='Add'; return; }
      data.title  = title;
      data.desc   = document.getElementById('f-desc')?.value?.trim()  || '';
      data.date   = document.getElementById('f-date')?.value?.trim()   || 'Today';
      data.link   = document.getElementById('f-link')?.value?.trim()   || '';
      data.badge  = document.getElementById('f-badge')?.value          || '';
      data.pinned = document.getElementById('f-pin')?.value === 'yes';
    }
    await addDoc(collection(db, `${subject}_${section}`), data);
    closeModal(); toast('Added successfully');
  } catch(e) { toast('Error saving — try again', 'ti-alert-triangle'); btn.disabled=false; btn.textContent='Add'; }
}

export function closeModal() { document.getElementById('overlay').classList.remove('open'); }
export function openModal() { document.getElementById('overlay').classList.add('open'); }

window.submitAdd = submitAdd;
window.closeModal = closeModal;

document.getElementById('overlay').addEventListener('click', e => { if (e.target===document.getElementById('overlay')) closeModal(); });

import { db, storage, SUBJECT_META, SECTION_META, toast } from './config.v5.js';
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

export function openAdd(subject, section) {
  let fields = '';
  if (section === 'schedule') {
    fields = `
      <label>Day</label>
      <select id="f-day"><option>Sunday</option><option>Monday</option><option>Tuesday</option><option>Wednesday</option><option>Thursday</option><option>Friday</option><option>Saturday</option></select>
      <label>Time</label><input type="text" id="f-time" placeholder="e.g. 10:00 AM" />
      <label>Topic / Type</label><input type="text" id="f-topic" placeholder="e.g. Lecture, Office Hours" />
      <div style="display:flex; gap:10px; margin-top: 10px;">
        <div style="flex:1;"><label>Group #</label><input type="text" id="f-group" placeholder="e.g. G1" /></div>
        <div style="flex:1;"><label>Lesson #</label><input type="text" id="f-lesson" placeholder="e.g. L12" /></div>
      </div>`;
  } else if (section === 'marks') {
    fields = `
      <label>Quiz Title</label><input type="text" id="m-quiz-title" placeholder="e.g. Quiz 1 - Pure Math" />
      <label>Upload CSV <span style="text-transform:none;color:var(--paper-text-faint)">(Format: email,mark)</span></label>
      <input type="file" id="m-csv-file" accept=".csv,text/csv" />
      <p style="font-size:11px; color:var(--paper-text-faint); margin-top:10px;">Create an Excel file with two columns (Email and Mark), then save as CSV.</p>`;
    
    const subjLabel = SUBJECT_META[subject]?.label || subject;
    document.getElementById('modal').innerHTML = `
      <h2>Manage Marks <span>— ${subjLabel}</span></h2>${fields}
      <div class="modal-footer">
        <button class="btn-cancel" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" id="m-upload-btn" onclick="window.handleMarksUpload('${subject}')">Upload Marks</button>
      </div>`;
    openModal();
    return;
  } else {
    let fileInput = '';
    if (section === 'homework') {
      fileInput = `<label>Upload Image <span style="text-transform:none;color:var(--paper-text-faint)">(JPG, PNG, GIF, WebP)</span></label>
                   <input type="file" id="f-file" accept="image/jpeg,image/png,image/gif,image/webp" />`;
    } else if (['recordings', 'notes'].includes(section)) {
      fileInput = `<label>Upload PDF</label>
                   <input type="file" id="f-file" accept="application/pdf" />`;
    }

    fields = `
      <label>Title</label><input type="text" id="f-title" placeholder="Enter title…" />
      <label>Description <span style="text-transform:none;color:var(--paper-text-faint)">(optional)</span></label><textarea id="f-desc" placeholder="Add details…"></textarea>
      <label>${section==='homework'?'Due date':'Date'}</label>
      <input type="text" id="f-date" placeholder="${section==='homework'?'e.g. Due: Jul 5':'e.g. Jun 28'}" />
      ${fileInput}
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
  const fileEl = document.getElementById('f-file');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    let data = { createdAt: serverTimestamp() };
    if (section === 'schedule') {
      data.day    = document.getElementById('f-day').value;
      data.time   = document.getElementById('f-time').value || '—';
      data.topic  = document.getElementById('f-topic').value || 'Class';
      data.group  = document.getElementById('f-group').value || '';
      data.lesson = document.getElementById('f-lesson').value || '';
    } else {
      const title = document.getElementById('f-title')?.value?.trim();
      if (!title) { document.getElementById('f-title').focus(); btn.disabled=false; btn.textContent='Add'; return; }
      data.title  = title;
      data.desc   = document.getElementById('f-desc')?.value?.trim()  || '';
      data.date   = document.getElementById('f-date')?.value?.trim()   || 'Today';
      data.badge  = document.getElementById('f-badge')?.value          || '';
      data.pinned = document.getElementById('f-pin')?.value === 'yes';
      if (fileEl && fileEl.files[0]) {
        const file = fileEl.files[0];
        let path = section === 'homework' ? `homework-images/${subject}/${Date.now()}_${file.name}` : `pdfs/${subject}/${Date.now()}_${file.name}`;
        btn.textContent = 'Uploading file…';
        const storageRef = ref(storage, path);
        const snapshot = await uploadBytes(storageRef, file);
        data.link = await getDownloadURL(snapshot.ref);
      } else { data.link = ''; }
    }
    await addDoc(collection(db, `${subject}_${section}`), data);
    closeModal(); toast('Added successfully');
  } catch(e) { console.error(e); toast('Error saving', 'ti-alert-triangle'); btn.disabled=false; btn.textContent='Add'; }
}

export function closeModal() { document.getElementById('overlay').classList.remove('open'); }
export function openModal() { document.getElementById('overlay').classList.add('open'); }

window.submitAdd = submitAdd;
window.closeModal = closeModal;
document.getElementById('overlay').addEventListener('click', e => { if (e.target===document.getElementById('overlay')) closeModal(); });

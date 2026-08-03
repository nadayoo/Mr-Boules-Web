import { db, storage, SUBJECT_META, SECTION_META, toast } from './config.js';
import { collection, addDoc, doc, setDoc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { state } from './auth.js';

export function openAdd(subject, section) {
  let fields = '';
  if (section === 'schedule') {
    fields = `
      <label>Day</label>
      <select id="f-day"><option>Sunday</option><option>Monday</option><option>Tuesday</option><option>Wednesday</option><option>Thursday</option><option>Friday</option><option>Saturday</option></select>
      <label>Time</label><input type="text" id="f-time" placeholder="e.g. 10:00 AM" />
      <div style="display:flex; gap:10px; margin-top: 10px;">
        <div style="flex:1;"><label>Group #</label><input type="text" id="f-group" placeholder="e.g. G1" /></div>
        <div style="flex:1;"><label>Lesson #</label><input type="text" id="f-lesson" placeholder="e.g. L12" /></div>
      </div>`;
  } else if (section === 'marks') {
    fields = `
      <label>Quiz Title</label>
      <input type="text" id="m-quiz-title" placeholder="e.g. Quiz 1 - Pure Math" />

      <label>CSV File <span style="text-transform:none;color:var(--paper-text-faint)">(email, mark, id)</span></label>
      <input type="file" id="m-csv-file" accept=".csv,text/csv" />

      <label>ZIP of PDFs <span style="text-transform:none;color:var(--paper-text-faint)">(named by student ID, e.g. A0A56.pdf)</span></label>
      <input type="file" id="m-zip-file" accept=".zip,application/zip" />

      <p style="font-size:11px; color:var(--paper-text-faint); margin-top:12px; line-height:1.5;">
        CSV format: <code>email,mark,id</code><br>
        Example: <code>ahmed@gmail.com,85,A0A56</code><br>
        ZIP must contain PDFs named exactly like the ID (A0A56.pdf)
      </p>`;

    const subjLabel = SUBJECT_META[subject]?.label || subject;
    document.getElementById('modal').innerHTML = `
      <h2>Upload Marks + PDFs <span>— ${subjLabel}</span></h2>${fields}
      <div class="modal-footer">
        <button class="btn-cancel" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" id="m-upload-btn" onclick="window.handleMarksUpload('${subject}')">Upload Marks</button>
      </div>`;
    openModal();
    return;
  } else {
    let fileInput = '';
    if (section === 'homework') {
      fileInput = `
        <label>Upload Images <span style="text-transform:none;color:var(--paper-text-faint)">(max 2)</span></label>
        <input type="file" id="f-images" accept="image/jpeg,image/png,image/gif,image/webp" multiple />

        <label style="margin-top:12px;">Upload PDFs <span style="text-transform:none;color:var(--paper-text-faint)">(max 2)</span></label>
        <input type="file" id="f-pdfs" accept="application/pdf" multiple />
      `;
    } else if (section === 'notes') {
      fileInput = `<label>Upload PDF</label>
                   <input type="file" id="f-file" accept="application/pdf" />`;
    }

    fields = `
      <label>Title</label><input type="text" id="f-title" placeholder="Enter title…" />
      ${section==='notes'?`<label>Chapter Number</label><input type="text" id="f-chapter" placeholder="e.g. Chapter 4" />`:''}
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
  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    let data = { createdAt: serverTimestamp() };

    if (section === 'schedule') {
      data.day    = document.getElementById('f-day').value;
      data.time   = document.getElementById('f-time').value || '—';
      data.group  = document.getElementById('f-group').value || '';
      data.lesson = document.getElementById('f-lesson').value || '';
    } else {
      const title = document.getElementById('f-title')?.value?.trim();
      if (!title) {
        document.getElementById('f-title').focus();
        btn.disabled = false;
        btn.textContent = 'Add';
        return;
      }
      data.title   = title;
      data.chapter = document.getElementById('f-chapter')?.value?.trim() || '';
      data.desc    = document.getElementById('f-desc')?.value?.trim()  || '';
      data.date    = document.getElementById('f-date')?.value?.trim()   || 'Today';
      data.badge   = document.getElementById('f-badge')?.value          || '';
      data.pinned  = document.getElementById('f-pin')?.value === 'yes';

      if (section === 'homework') {
        data.images = [];
        data.pdfs = [];

        const imageInput = document.getElementById('f-images');
        const pdfInput = document.getElementById('f-pdfs');

        if (imageInput && imageInput.files.length) {
          const images = Array.from(imageInput.files).slice(0, 2);
          for (const file of images) {
            btn.textContent = `Uploading image…`;
            const path = `homework-images/${subject}/${Date.now()}_${file.name}`;
            const storageRef = ref(storage, path);
            const snapshot = await uploadBytes(storageRef, file);
            data.images.push(await getDownloadURL(snapshot.ref));
          }
        }

        if (pdfInput && pdfInput.files.length) {
          const pdfs = Array.from(pdfInput.files).slice(0, 2);
          for (const file of pdfs) {
            btn.textContent = `Uploading PDF…`;
            const path = `homework-pdfs/${subject}/${Date.now()}_${file.name}`;
            const storageRef = ref(storage, path);
            const snapshot = await uploadBytes(storageRef, file);
            data.pdfs.push(await getDownloadURL(snapshot.ref));
          }
        }
      } else {
        const fileEl = document.getElementById('f-file');
        if (fileEl && fileEl.files[0]) {
          const file = fileEl.files[0];
          const path = `pdfs/${subject}/${Date.now()}_${file.name}`;
          btn.textContent = 'Uploading file…';
          const storageRef = ref(storage, path);
          const snapshot = await uploadBytes(storageRef, file);
          data.link = await getDownloadURL(snapshot.ref);
        } else {
          data.link = '';
        }
      }
    }

    await addDoc(collection(db, `${subject}_${section}`), data);
    closeModal();
    toast('Added successfully');
  } catch (e) {
    console.error(e);
    toast('Error saving', 'ti-alert-triangle');
    btn.disabled = false;
    btn.textContent = 'Add';
  }
}

// ========== STUDENT SUBMISSION ==========
export async function openStudentSubmit(subject, homeworkId, title) {
  try {
    const subRef = doc(db, 'submissions', `${state.userEmail}_${homeworkId}`);
    const snap = await getDoc(subRef);
    if (snap.exists()) {
      toast('You already submitted this homework', 'ti-alert-triangle');
      return;
    }
  } catch (e) {
    console.error(e);
  }

  document.getElementById('modal').innerHTML = `
    <h2>Submit your work <span>— ${title}</span></h2>
    <label>Upload Image or PDF</label>
    <input type="file" id="s-file" accept="image/jpeg,image/png,image/gif,image/webp,application/pdf" />
    <p style="font-size:12px;color:var(--paper-text-faint);margin-top:10px;">
      You can only submit <strong>once</strong>. Make sure it’s the correct file.
    </p>
    <div class="modal-footer">
      <button class="btn-cancel" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" id="s-submit-btn" onclick="window.submitStudentWork('${subject}','${homeworkId}')">
        Submit
      </button>
    </div>
  `;
  openModal();
}

export async function submitStudentWork(subject, homeworkId) {
  const btn = document.getElementById('s-submit-btn');
  const fileInput = document.getElementById('s-file');

  if (!fileInput.files[0]) {
    toast('Please select a file', 'ti-alert-triangle');
    return;
  }

  // Prevent double submit
  try {
    const subRef = doc(db, 'submissions', `${state.userEmail}_${homeworkId}`);
    const snap = await getDoc(subRef);
    if (snap.exists()) {
      toast('You already submitted this homework', 'ti-alert-triangle');
      closeModal();
      return;
    }
  } catch (e) {}

  btn.disabled = true;
  btn.textContent = 'Uploading…';

  try {
    const file = fileInput.files[0];
    const isPdf = file.type === 'application/pdf';
    const folder = isPdf ? 'student-pdfs' : 'student-images';
    const path = `${folder}/${subject}/${state.userEmail}_${homeworkId}_${Date.now()}_${file.name}`;

    const storageRef = ref(storage, path);
    const snapshot = await uploadBytes(storageRef, file);
    const url = await getDownloadURL(snapshot.ref);

    const subRef = doc(db, 'submissions', `${state.userEmail}_${homeworkId}`);
    await setDoc(subRef, {
      email: state.userEmail,
      subject,
      homeworkId,
      url,
      fileType: isPdf ? 'pdf' : 'image',
      submittedAt: serverTimestamp()
    });

    closeModal();
    toast('Submitted successfully!');

    // ===== Immediately update the UI without reloading =====
    const card = document.getElementById(`hw-card-${homeworkId}`);
    if (card) {
      const submitArea = card.querySelector('.card-body > div:last-child');
      if (submitArea) {
        submitArea.innerHTML = `
          <div style="font-size:13px; color:var(--chalk-teal);">
            <i class="ti ti-check"></i> You already submitted this homework
            — <a href="${url}" target="_blank" style="color:var(--chalk-teal);text-decoration:underline;">View your file</a>
          </div>
        `;
      }
    }

  } catch (e) {
    console.error(e);
    toast('Upload failed', 'ti-alert-triangle');
    btn.disabled = false;
    btn.textContent = 'Submit';
  }
}

export function closeModal() {
  document.getElementById('overlay').classList.remove('open');
}
export function openModal() {
  document.getElementById('overlay').classList.add('open');
}

window.submitAdd = submitAdd;
window.closeModal = closeModal;
window.openStudentSubmit = openStudentSubmit;
window.submitStudentWork = submitStudentWork;

document.getElementById('overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('overlay')) closeModal();
});
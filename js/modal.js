import { db, storage, SUBJECT_META, SECTION_META, toast } from './config.js';
import {
  collection,
  addDoc,
  doc,
  setDoc,
  getDoc,
  getDocs,
  serverTimestamp,
  updateDoc,
  increment
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { state } from './auth.js';
import { GROUPS, usesGroups, lessonOf, groupOf, cleanLessonTitle, getLesson, getCachedHomework, lessonItemIds, setMyGroup } from './groups.js';

export function openAdd(subject, section) {
  let fields = '';

  if (section === 'schedule') {
    fields = `
      <label>Day</label>
      <select id="f-day">
        <option>Sunday</option><option>Monday</option><option>Tuesday</option>
        <option>Wednesday</option><option>Thursday</option><option>Friday</option><option>Saturday</option>
      </select>
      <label>Time</label>
      <input type="text" id="f-time" placeholder="e.g. 10:00 AM" />
      <div style="display:flex; gap:10px; margin-top:10px;">
        <div style="flex:1;"><label>Group #</label><input type="text" id="f-group" placeholder="e.g. G1" /></div>
        <div style="flex:1;"><label>Lesson #</label><input type="text" id="f-lesson" placeholder="e.g. L12" /></div>
      </div>`;
  } else if (section === 'marks') {
    fields = `
      <label>Quiz Title</label>
      <input type="text" id="m-quiz-title" placeholder="e.g. Quiz 1 - Pure Math" />
      <label>CSV File <span style="text-transform:none;color:var(--paper-text-faint)">(email, mark, id)</span></label>
      <input type="file" id="m-csv-file" accept=".csv,text/csv" />
      <label>ZIP of PDFs <span style="text-transform:none;color:var(--paper-text-faint)">(named by student ID)</span></label>
      <input type="file" id="m-zip-file" accept=".zip,application/zip" />
      <p style="font-size:11px; color:var(--paper-text-faint); margin-top:12px; line-height:1.5;">
        CSV format: <code>email,mark,id</code>
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
  } else if (section === 'homework' && usesGroups(subject)) {
    const subjLabel = SUBJECT_META[subject]?.label || subject;
    const small = 'style="text-transform:none;color:var(--paper-text-faint)"';
    const groupRows = GROUPS.map(g => `
      <div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap;">
        <label style="display:flex;align-items:center;gap:6px;min-width:88px;margin:0;text-transform:none;">
          <input type="checkbox" id="g-on-${g}" /> Group ${g}
        </label>
        <input type="datetime-local" id="g-deadline-${g}" title="Deadline" style="flex:1;min-width:165px;" />
        <input type="datetime-local" id="g-publish-${g}" title="Publish at (optional)" style="flex:1;min-width:165px;" />
      </div>`).join('');

    document.getElementById('modal').innerHTML = `
      <h2>Add homework <span>— ${subjLabel}</span></h2>
      <label>Lesson number</label>
      <input type="number" id="hw-lesson" min="1" placeholder="e.g. 1" />
      <label>Homework title</label>
      <input type="text" id="hw-title" placeholder="e.g. Homework 1" />
      <label>Description <span ${small}>(optional)</span></label>
      <textarea id="f-desc" placeholder="Add details…"></textarea>
      <label style="margin-top:12px;">Upload Images <span ${small}>(max 2)</span></label>
      <input type="file" id="f-images" accept="image/jpeg,image/png,image/gif,image/webp" multiple />
      <label style="margin-top:12px;">Upload PDFs <span ${small}>(max 2)</span></label>
      <input type="file" id="f-pdfs" accept="application/pdf" multiple />

      <label style="margin-top:14px;">Groups <span ${small}>(tick each group that gets this homework)</span></label>
      <div style="display:flex;gap:8px;margin-top:6px;font-size:11px;color:var(--paper-text-faint);">
        <span style="min-width:88px;"></span>
        <span style="flex:1;min-width:165px;">Deadline</span>
        <span style="flex:1;min-width:165px;">Publish at (optional)</span>
      </div>
      ${groupRows}
      <p style="font-size:11px;color:var(--paper-text-faint);margin-top:10px;line-height:1.5;">
        One post is created per ticked group, with its own deadline. Leave "Publish at" empty to post right away.
        To post another group later, open this form again and tick only that group.
      </p>
      <div class="modal-footer">
        <button class="btn-cancel" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" id="submit-btn" onclick="submitAdd('${subject}','homework')">Add</button>
      </div>`;
    openModal();
    return;
  } else if (section === 'attendance') {
    const subjLabel = SUBJECT_META[subject]?.label || subject;
    document.getElementById('modal').innerHTML = `
      <h2>Upload attendance <span>— ${subjLabel}</span></h2>
      <label>Session Title</label>
      <input type="text" id="att-session-name" placeholder="e.g. Session 12 - Pure Math" />

      <label>Date</label>
      <input type="date" id="att-date" />

      <label>Attendance CSV File <span style="text-transform:none;color:var(--paper-text-faint)">(student IDs)</span></label>
      <input type="file" id="att-csv-file" accept=".csv" />

      <div class="modal-footer">
        <button class="btn-cancel" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" id="att-upload-btn" onclick="window.handleAttendanceUpload('${subject}')">Upload</button>
      </div>`;
    openModal();
    return;
  } else {
    let fileInput = '';

    if (section === 'homework') {
      fileInput = `
        <label>Deadline</label>
        <input type="datetime-local" id="f-deadline" />

        <label style="margin-top:12px;">Upload Images <span style="text-transform:none;color:var(--paper-text-faint)">(max 2)</span></label>
        <input type="file" id="f-images" accept="image/jpeg,image/png,image/gif,image/webp" multiple />

        <label style="margin-top:12px;">Upload PDFs <span style="text-transform:none;color:var(--paper-text-faint)">(max 2)</span></label>
        <input type="file" id="f-pdfs" accept="application/pdf" multiple />
      `;
    } else if (section === 'notes') {
      fileInput = `
        <label>Upload PDF</label>
        <input type="file" id="f-file" accept="application/pdf" />
      `;
    }

    fields = `
      <label>Title</label>
      <input type="text" id="f-title" placeholder="Enter title…" />
      ${section === 'notes' ? `<label>Chapter Number</label><input type="text" id="f-chapter" placeholder="e.g. Chapter 4" />` : ''}
      <label>Description <span style="text-transform:none;color:var(--paper-text-faint)">(optional)</span></label>
      <textarea id="f-desc" placeholder="Add details…"></textarea>
      ${section !== 'homework' ? `
        <label>Date</label>
        <input type="date" id="f-date" />
      ` : ''}
      ${fileInput}
      ${section === 'announcements' ? `
        <label>Badge</label>
        <select id="f-badge">
          <option value="">None</option>
          <option value="new">New</option>
          <option value="important">Important</option>
        </select>
        <label>Pin to top?</label>
        <select id="f-pin">
          <option value="">No</option>
          <option value="yes">Yes</option>
        </select>
      ` : ''}
      ${section === 'homework' ? `
        <label>Status</label>
        <select id="f-badge">
          <option value="due">Due</option>
          <option value="done">Done</option>
        </select>
      ` : ''}
      ${['announcements', 'homework', 'notes'].includes(section) ? `
        <label style="margin-top:12px;">Publish at <span style="text-transform:none;color:var(--paper-text-faint)">(optional, leave empty to publish now)</span></label>
        <input type="datetime-local" id="f-publish" />
      ` : ''}
    `;
  }

  const subjLabel = SUBJECT_META[subject]?.label || subject;
  document.getElementById('modal').innerHTML = `
    <h2>${SECTION_META[section].addLabel} <span>— ${subjLabel}</span></h2>
    ${fields}
    <div class="modal-footer">
      <button class="btn-cancel" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" id="submit-btn" onclick="submitAdd('${subject}','${section}')">Add</button>
    </div>
  `;
  openModal();
}

export async function submitAdd(subject, section) {
  // Homework is handled by submitHomework() (one post per ticked group)
  if (section === 'homework' && usesGroups(subject)) return submitHomework(subject);

  const btn = document.getElementById('submit-btn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    let data = { createdAt: serverTimestamp() };

    if (section === 'schedule') {
      data.day = document.getElementById('f-day').value;
      data.time = document.getElementById('f-time').value || '—';
      data.group = document.getElementById('f-group').value || '';
      data.lesson = document.getElementById('f-lesson').value || '';
    } else {
      const title = document.getElementById('f-title')?.value?.trim();
      if (!title) {
        document.getElementById('f-title').focus();
        btn.disabled = false;
        btn.textContent = 'Add';
        return;
      }

      data.title = title;
      data.chapter = document.getElementById('f-chapter')?.value?.trim() || '';
      data.desc = document.getElementById('f-desc')?.value?.trim() || '';
      data.badge = document.getElementById('f-badge')?.value || '';
      data.pinned = document.getElementById('f-pin')?.value === 'yes';

      // Timed post: students only see it once this time has passed
      const publishValue = document.getElementById('f-publish')?.value;
      if (publishValue) data.publishAt = new Date(publishValue);

      if (section === 'homework') {
        const deadlineValue = document.getElementById('f-deadline')?.value;
        if (!deadlineValue) {
          toast('Please set a deadline', 'ti-alert-triangle');
          btn.disabled = false;
          btn.textContent = 'Add';
          return;
        }

        data.deadline = new Date(deadlineValue).toISOString();
        data.date = new Date(deadlineValue).toLocaleString();

        const hwSnap = await getDocs(collection(db, `${subject}_homework`));
        const nextNum = hwSnap.size + 1;
        data.hwCode = `hw${String(nextNum).padStart(2, '0')}`;

        data.images = [];
        data.pdfs = [];

        const imageInput = document.getElementById('f-images');
        const pdfInput = document.getElementById('f-pdfs');

        if (imageInput?.files?.length) {
          const images = Array.from(imageInput.files).slice(0, 2);
          for (const file of images) {
            btn.textContent = 'Uploading image…';
            const path = `homework-images/${subject}/${Date.now()}_${file.name}`;
            const storageRef = ref(storage, path);
            const snapshot = await uploadBytes(storageRef, file);
            data.images.push(await getDownloadURL(snapshot.ref));
          }
        }

        if (pdfInput?.files?.length) {
          const pdfs = Array.from(pdfInput.files).slice(0, 2);
          for (const file of pdfs) {
            btn.textContent = 'Uploading PDF…';
            const path = `homework-pdfs/${subject}/${Date.now()}_${file.name}`;
            const storageRef = ref(storage, path);
            const snapshot = await uploadBytes(storageRef, file);
            data.pdfs.push(await getDownloadURL(snapshot.ref));
          }
        }
      } else {
        const rawDate = document.getElementById('f-date')?.value;
        if (rawDate) {
          const parsed = new Date(rawDate);
          data.date = !isNaN(parsed) 
            ? parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : rawDate;
        } else {
          data.date = 'Today';
        }

        const fileEl = document.getElementById('f-file');
        if (fileEl?.files?.[0]) {
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

async function submitHomework(subject) {
  const btn = document.getElementById('submit-btn');
  const lesson = parseInt(document.getElementById('hw-lesson')?.value, 10);
  const hwTitle = document.getElementById('hw-title')?.value?.trim();
  const desc = document.getElementById('f-desc')?.value?.trim() || '';
  const chosen = GROUPS.filter(g => document.getElementById(`g-on-${g}`)?.checked);

  const fail = (msg) => {
    toast(msg, 'ti-alert-triangle');
    btn.disabled = false;
    btn.textContent = 'Add';
  };

  if (isNaN(lesson) || lesson < 1) return fail('Please enter the lesson number');
  if (!hwTitle) return fail('Please enter a homework title');
  if (!chosen.length) return fail('Tick at least one group');
  for (const g of chosen) {
    if (!document.getElementById(`g-deadline-${g}`)?.value) return fail(`Set a deadline for Group ${g}`);
  }

  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const colRef = collection(db, `${subject}_homework`);

    // Don't create a second post for a group that already has this lesson
    const existing = await getDocs(colRef);
    const taken = new Set();
    existing.forEach(d => {
      const x = d.data();
      if (lessonOf(x) === lesson) taken.add(groupOf(x));
    });
    const dup = chosen.filter(g => taken.has(g));
    if (dup.length) return fail(`Group ${dup.join(', ')} already has a Lesson ${lesson} homework`);

    // Upload files once, share them between all groups
    const images = [];
    const pdfs = [];
    const imageInput = document.getElementById('f-images');
    const pdfInput = document.getElementById('f-pdfs');

    if (imageInput?.files?.length) {
      for (const file of Array.from(imageInput.files).slice(0, 2)) {
        btn.textContent = 'Uploading image…';
        const storageRef = ref(storage, `homework-images/${subject}/${Date.now()}_${file.name}`);
        const snapshot = await uploadBytes(storageRef, file);
        images.push(await getDownloadURL(snapshot.ref));
      }
    }
    if (pdfInput?.files?.length) {
      for (const file of Array.from(pdfInput.files).slice(0, 2)) {
        btn.textContent = 'Uploading PDF…';
        const storageRef = ref(storage, `homework-pdfs/${subject}/${Date.now()}_${file.name}`);
        const snapshot = await uploadBytes(storageRef, file);
        pdfs.push(await getDownloadURL(snapshot.ref));
      }
    }

    // One post per ticked group
    btn.textContent = 'Saving…';
    for (const g of chosen) {
      const deadline = new Date(document.getElementById(`g-deadline-${g}`).value);
      const data = {
        title: `Lesson ${lesson}, Group ${g}: ${hwTitle}`,
        lesson,
        group: g,
        hwCode: `hw${String(lesson).padStart(2, '0')}`,
        desc,
        badge: 'due',
        chapter: '',
        pinned: false,
        deadline: deadline.toISOString(),
        date: deadline.toLocaleString(),
        images,
        pdfs,
        createdAt: serverTimestamp()
      };
      const pub = document.getElementById(`g-publish-${g}`)?.value;
      if (pub) data.publishAt = new Date(pub);
      await addDoc(colRef, data);
    }

    closeModal();
    toast(`Homework added for ${chosen.length} group${chosen.length > 1 ? 's' : ''}`);
  } catch (e) {
    console.error(e);
    fail('Error saving');
  }
}

// True if this homework's deadline has already passed (uses the cached homework list)
function isPastDeadline(subject, homeworkId) {
  const item = (getCachedHomework(subject) || []).find(i => i._id === homeworkId);
  return !!(item && item.deadline && Date.now() > new Date(item.deadline).getTime());
}

// Storage subfolder for a group, e.g. "/group-5" (Cambridge only; Edexcel stays flat)
function groupFolder(subject, title) {
  const g = usesGroups(subject) ? groupOf({ title }) : '';
  return g ? `/group-${g}` : '';
}

// True if the student already submitted ANY homework of this lesson (any group)
async function hasLessonSubmission(subject, homeworkId) {
  const ids = usesGroups(subject) ? lessonItemIds(subject, homeworkId) : [homeworkId];
  for (const id of ids) {
    const snap = await getDoc(doc(db, 'submissions', `${state.userEmail}_${id}`));
    if (snap.exists()) return true;
  }
  return false;
}

// Shown when a student clicks "Submit my work" before choosing a group
export function openGroupPicker(subject, lessonKey) {
  const lesson = getLesson(subject, lessonKey);
  if (!lesson) return;
  const buttons = GROUPS.map(g => {
    const posted = !!lesson.byGroup[g];
    return `<button class="btn-cancel" ${posted ? '' : 'disabled'}
      style="padding:8px 16px;margin:0 8px 8px 0;${posted ? '' : 'opacity:.45;cursor:not-allowed;'}"
      onclick="window.pickGroupAndSubmit('${subject}','${lessonKey}','${g}')">
      Group ${g}${posted ? '' : ' (not posted yet)'}</button>`;
  }).join('');

  document.getElementById('modal').innerHTML = `
    <h2>Which group are you in? <span>— ${cleanLessonTitle(lesson.items[0]?.title)}</span></h2>
    <p style="font-size:13px;color:var(--paper-text-faint);margin:8px 0 14px;">
      Your group decides your homework and deadline. You can't change it after you submit.
    </p>
    <div style="display:flex;flex-wrap:wrap;">${buttons}</div>
    <div class="modal-footer">
      <button class="btn-cancel" onclick="closeModal()">Cancel</button>
    </div>`;
  openModal();
}

export async function pickGroupAndSubmit(subject, lessonKey, group) {
  const lesson = getLesson(subject, lessonKey);
  const item = lesson?.byGroup[group];
  if (!item) return;

  setMyGroup(state.userEmail, group);
  window.rerenderHomework?.(subject);

  if (item.deadline && Date.now() > new Date(item.deadline).getTime()) {
    closeModal();
    toast(`Submissions for Group ${group} are closed`, 'ti-alert-triangle');
    return;
  }
  await openStudentSubmit(subject, item._id, item.title, item.hwCode || '');
}

export async function openStudentSubmit(subject, homeworkId, title, hwCode = '') {
  if (isPastDeadline(subject, homeworkId)) {
    closeModal();
    toast('The deadline has passed, so this homework is closed', 'ti-alert-triangle');
    window.rerenderHomework?.(subject);
    return;
  }
  try {
    if (await hasLessonSubmission(subject, homeworkId)) {
      toast('You already submitted this homework', 'ti-alert-triangle');
      return;
    }
  } catch (e) {
    console.error(e);
  }

  const safeTitle = (title || '').replace(/'/g, "\\'");
  const safeCode = (hwCode || '').replace(/'/g, "\\'");

  document.getElementById('modal').innerHTML = `
    <h2>Submit your work <span>— ${title}</span></h2>
    <label>Upload PDF</label>
    <input type="file" id="s-file" accept="application/pdf,.pdf" />
    <p style="font-size:12px;color:var(--paper-text-faint);margin-top:10px;">
      You can only submit <strong>once</strong>.
    </p>
    <div class="modal-footer">
      <button class="btn-cancel" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" id="s-submit-btn"
        onclick="window.submitStudentWork('${subject}','${homeworkId}','${safeTitle}','${safeCode}')">
        Submit
      </button>
    </div>
  `;
  openModal();
}

export async function submitStudentWork(subject, homeworkId, title = '', hwCode = '') {
  const btn = document.getElementById('s-submit-btn');
  const fileInput = document.getElementById('s-file');

  // Already running (double tap / repeated clicks): ignore
  if (btn.disabled) return;

  if (!fileInput.files[0]) {
    toast('Please select a file', 'ti-alert-triangle');
    return;
  }

  const picked = fileInput.files[0];
  const looksLikePdf = picked.type === 'application/pdf' || picked.name.toLowerCase().endsWith('.pdf');
  if (!looksLikePdf) {
    toast('Only PDF files are allowed', 'ti-alert-triangle');
    return;
  }

  // Deadline may have passed while the page was open
  if (isPastDeadline(subject, homeworkId)) {
    closeModal();
    toast('The deadline has passed, so this homework is closed', 'ti-alert-triangle');
    window.rerenderHomework?.(subject);
    return;
  }

  // Lock the button straight away, before any network call, so extra taps can't start more uploads
  btn.disabled = true;
  btn.textContent = 'Uploading…';

  try {
    if (await hasLessonSubmission(subject, homeworkId)) {
      toast('You already submitted this homework', 'ti-alert-triangle');
      closeModal();
      return;
    }
  } catch (e) {}

  try {
    const file = fileInput.files[0];
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');

    const folderName = hwCode || homeworkId;
    const path = `student-submissions/${subject}/${folderName}${groupFolder(subject, title)}/${state.userEmail}_${Date.now()}_${safeName}`;

    const storageRef = ref(storage, path);
    const snapshot = await uploadBytes(storageRef, file, { contentType: 'application/pdf' });
    const url = await getDownloadURL(snapshot.ref);

    const subRef = doc(db, 'submissions', `${state.userEmail}_${homeworkId}`);
    await setDoc(subRef, {
      email: state.userEmail,
      subject,
      homeworkId,
      homeworkTitle: title,
      hwCode: hwCode || '',
      group: groupOf({ title }) || '',
      url,
      fileType: 'pdf',
      path,
      submittedAt: serverTimestamp()
    });

    closeModal();
    toast('Submitted successfully!');
    setTimeout(() => window.rerenderHomework?.(subject), 0);

    const card = document.getElementById(`hw-card-${homeworkId}`);
    if (card) {
      const area = card.querySelector('[data-submit-area]');
      if (area) {
        area.innerHTML = `
          <div style="font-size:13px; color:var(--chalk-teal);">
            <i class="ti ti-check"></i> You already submitted this homework
            — <a href="${url}" target="_blank" style="color:var(--chalk-teal);text-decoration:underline;">View your file</a>
          </div>`;
      }
    }
  } catch (e) {
    console.error(e);
    toast('Upload failed', 'ti-alert-triangle');
    btn.disabled = false;
    btn.textContent = 'Submit';
  }
}

// ---- Replace an existing submission (allowed until the deadline) ----
export function openReplaceSubmit(subject, homeworkId, deadlineId) {
  const item = (getCachedHomework(subject) || []).find(i => i._id === (deadlineId || homeworkId));
  const title = item ? cleanLessonTitle(item.title) : '';

  document.getElementById('modal').innerHTML = `
    <h2>Replace your submission <span>— ${title}</span></h2>
    <label>Upload new PDF</label>
    <input type="file" id="r-file" accept="application/pdf,.pdf" />
    <p style="font-size:12px;color:var(--paper-text-faint);margin-top:10px;">
      This replaces the file you submitted before. You can do this until the deadline.
    </p>
    <div class="modal-footer">
      <button class="btn-cancel" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" id="r-submit-btn"
        onclick="window.submitReplacement('${subject}','${homeworkId}','${deadlineId || homeworkId}')">Replace</button>
    </div>
  `;
  openModal();
}

export async function submitReplacement(subject, homeworkId, deadlineId) {
  const btn = document.getElementById('r-submit-btn');
  const file = document.getElementById('r-file')?.files?.[0];

  if (!file) {
    toast('Please select a file', 'ti-alert-triangle');
    return;
  }
  if (!(file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))) {
    toast('Only PDF files are allowed', 'ti-alert-triangle');
    return;
  }

  // The deadline of the post the student is currently shown (their group's post)
  const item = (getCachedHomework(subject) || []).find(i => i._id === (deadlineId || homeworkId));
  if (item?.deadline && Date.now() > new Date(item.deadline).getTime()) {
    closeModal();
    toast('The deadline has passed, so you can no longer replace your file', 'ti-alert-triangle');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Uploading…';

  try {
    const subRef = doc(db, 'submissions', `${state.userEmail}_${homeworkId}`);
    const snap = await getDoc(subRef);
    if (!snap.exists()) {
      toast('No submission found to replace', 'ti-alert-triangle');
      btn.disabled = false;
      btn.textContent = 'Replace';
      return;
    }
    const old = snap.data();

    // Keep the new file next to the old one. If the record's group was corrected by an admin,
    // use the corrected group's folder (e.g. .../hw02/group-1/).
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const parts = old.path ? old.path.split('/') : [];
    const recGroup = usesGroups(subject) ? String(old.group || '').trim().toLowerCase() : '';
    let folder;
    if (parts.length >= 4 && recGroup) folder = `${parts.slice(0, 3).join('/')}/group-${recGroup}`;
    else if (parts.length >= 2) folder = parts.slice(0, -1).join('/');
    else folder = `student-submissions/${subject}/${item?.hwCode || homeworkId}${groupFolder(subject, item?.title)}`;
    const path = `${folder}/${state.userEmail}_${Date.now()}_${safeName}`;

    const storageRef = ref(storage, path);
    const snapshot = await uploadBytes(storageRef, file, { contentType: 'application/pdf' });
    const url = await getDownloadURL(snapshot.ref);

    // Update the same submission document. The sheet is not touched (it only runs on create).
    await updateDoc(subRef, {
      url,
      path,
      fileType: 'pdf',
      replacedAt: serverTimestamp(),
      replaceCount: increment(1)
    });

    // Delete the old file. A failure here is not fatal: the replacement already worked.
    if (old.path && old.path !== path && old.path.startsWith('student-submissions/')) {
      try {
        await deleteObject(ref(storage, old.path));
      } catch (delErr) {
        console.warn('Could not delete old submission file', delErr);
      }
    }

    closeModal();
    toast('Submission replaced');
    setTimeout(() => window.rerenderHomework?.(subject), 0);
  } catch (e) {
    console.error(e);
    toast('Replace failed', 'ti-alert-triangle');
    btn.disabled = false;
    btn.textContent = 'Replace';
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
window.openGroupPicker = openGroupPicker;
window.openReplaceSubmit = openReplaceSubmit;
window.submitReplacement = submitReplacement;
window.pickGroupAndSubmit = pickGroupAndSubmit;
window.submitStudentWork = submitStudentWork;

document.getElementById('overlay')?.addEventListener('click', e => {
  if (e.target === document.getElementById('overlay')) closeModal();
});
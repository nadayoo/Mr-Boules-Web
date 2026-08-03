import { esc, DAY_ORDER, toast, db } from './config.js';
import { state } from './auth.js';
import { doc, setDoc, deleteDoc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export function delBtn(subject, section, id) {
  return state.isAdmin ? `<button class="del-btn" onclick="window._del('${subject}','${section}','${id}')"><i class="ti ti-trash"></i></button>` : '';
}

export function renderAnnouncements(subject, data) {
  const el = document.getElementById(`list-${subject}-announcements`);
  if (!el) return;
  if (!data.length) {
    el.innerHTML = `<div class="empty"><i class="ti ti-speakerphone"></i><p>No announcements yet.</p></div>`;
    return;
  }
  el.innerHTML = data.map(item => `
    <div class="card ${item.pinned ? 'pin-card' : ''}">
      <div class="card-row">
        <div class="card-icon ann"><i class="ti ${item.pinned ? 'ti-pin' : 'ti-speakerphone'}"></i></div>
        <div class="card-body">
          <div class="card-title">${esc(item.title)} ${item.badge ? `<span class="badge ${esc(item.badge)}">${esc(item.badge)}</span>` : ''}</div>
          <div class="card-meta">${esc(item.date)}</div>
          ${item.desc ? `<div class="card-desc">${esc(item.desc)}</div>` : ''}
        </div>
        ${delBtn(subject, 'announcements', item._id)}
      </div>
    </div>`).join('');
}

export async function renderHomework(subject, data) {
  const el = document.getElementById(`list-${subject}-homework`);
  if (!el) return;
  if (!data.length) {
    el.innerHTML = `<div class="empty"><i class="ti ti-notebook"></i><p>No homework posted yet.</p></div>`;
    return;
  }

  // Load this student's submissions
  let mySubmissions = {};
  if (!state.isAdmin) {
    try {
      for (const item of data) {
        const subRef = doc(db, 'submissions', `${state.userEmail}_${item._id}`);
        const snap = await getDoc(subRef);
        if (snap.exists()) {
          mySubmissions[item._id] = snap.data();
        }
      }
    } catch (e) {
      console.error('Error loading submissions', e);
    }
  }

  // Check for 3 missed homeworks in a row
  let warningHtml = '';
  if (!state.isAdmin && data.length >= 3) {
    let consecutiveMissed = 0;
    for (let i = 0; i < Math.min(3, data.length); i++) {
      if (!mySubmissions[data[i]._id]) {
        consecutiveMissed++;
      } else {
        break;
      }
    }
    if (consecutiveMissed >= 3) {
      warningHtml = `
        <div style="background:var(--rust-dim); border:1px solid var(--rust-line); color:var(--rust); 
                    padding:12px 16px; border-radius:8px; margin-bottom:16px; font-size:13.5px;">
          <strong>Warning:</strong> You have not submitted the last 3 homeworks. Please catch up.
        </div>
      `;
    }
  }

  el.innerHTML = warningHtml + data.map(item => {
    const isDone = state.studentProgress?.[item._id] === true;
    const images = item.images || (item.link ? [item.link] : []);
    const pdfs = item.pdfs || [];
    const mySub = mySubmissions[item._id];

    return `
      <div class="card ${isDone ? 'done-card' : ''}" id="hw-card-${item._id}">
        <div class="card-row">
          <div class="card-icon hw"><i class="ti ti-notebook"></i></div>
          <div class="card-body">
            <div class="card-title">
              ${esc(item.title)}
              ${item.badge ? `<span class="badge ${esc(item.badge)}">${esc(item.badge)}</span>` : ''}
              ${!state.isAdmin ? `
                <label class="check-label">
                  <input type="checkbox" ${isDone ? 'checked' : ''} onchange="window.toggleHomework('${item._id}', this.checked)">
                  Done
                </label>
              ` : ''}
            </div>
            <div class="card-meta">${esc(item.date)}</div>
            ${item.desc ? `<div class="card-desc">${esc(item.desc)}</div>` : ''}

            ${images.length ? `
              <div class="hw-files" style="margin-top:10px;">
                ${images.map(url => `
                  <div class="img-preview" style="margin-bottom:8px;">
                    <img src="${esc(url)}" alt="Preview" style="max-width:100%;border-radius:8px;cursor:pointer;" 
                         onclick="window.open('${esc(url)}', '_blank')">
                  </div>
                `).join('')}
              </div>
            ` : ''}

            ${pdfs.length ? `
              <div style="margin-top:8px;">
                ${pdfs.map(url => `
                  <a class="card-link" href="${esc(url)}" target="_blank" rel="noopener" style="display:inline-block;margin-right:12px;">
                    <i class="ti ti-file-type-pdf"></i> Download PDF
                  </a>
                `).join('')}
              </div>
            ` : ''}

            ${!state.isAdmin ? `
              <div style="margin-top:14px;">
                ${mySub ? `
                  <div style="font-size:13px; color:var(--chalk-teal);">
                    <i class="ti ti-check"></i> You already submitted this homework
                    ${mySub.url ? ` — <a href="${esc(mySub.url)}" target="_blank" style="color:var(--chalk-teal);text-decoration:underline;">View your file</a>` : ''}
                  </div>
                ` : `
                  <button class="btn-primary" style="padding:7px 14px;font-size:13px;" 
                    onclick="window.openStudentSubmit('${subject}','${item._id}','${esc(item.title)}')">
                    <i class="ti ti-upload"></i> Submit my work
                  </button>
                `}
              </div>
            ` : ''}
          </div>
          ${delBtn(subject, 'homework', item._id)}
        </div>
      </div>`;
  }).join('');
}

export function renderNotes(subject, data) {
  const el = document.getElementById(`list-${subject}-notes`);
  if (!el) return;
  if (!data.length) {
    el.innerHTML = `<div class="empty"><i class="ti ti-file-text"></i><p>No notes posted yet.</p></div>`;
    return;
  }
  el.innerHTML = data.map(item => `
    <div class="card">
      <div class="card-row">
        <div class="card-icon note"><i class="ti ti-file-text"></i></div>
        <div class="card-body">
          <div class="card-title">${esc(item.title)} ${item.chapter ? `<span class="badge chapter">${esc(item.chapter)}</span>` : ''}</div>
          <div class="card-meta">${esc(item.date)}</div>
          ${item.desc ? `<div class="card-desc">${esc(item.desc)}</div>` : ''}
          ${item.link ? `<a class="card-link" href="${esc(item.link)}" target="_blank" rel="noopener"><i class="ti ti-external-link"></i> Open file</a>` : ''}
        </div>
        ${delBtn(subject, 'notes', item._id)}
      </div>
    </div>`).join('');
}

export function renderSchedule(subject, data) {
  const el = document.getElementById(`list-${subject}-schedule`);
  if (!el) return;
  if (!data.length) {
    el.innerHTML = `<div class="empty"><i class="ti ti-calendar"></i><p>No schedule posted yet.</p></div>`;
    return;
  }
  const grouped = {};
  data.forEach(item => {
    if (!grouped[item.day]) grouped[item.day] = [];
    grouped[item.day].push(item);
  });
  const sorted = Object.keys(grouped).sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
  el.innerHTML = `<div class="sched-grid">${sorted.map(day => `
    <div class="sched-day">
      <div class="sched-day-name">${esc(day)}</div>
      ${grouped[day].map(item => `
        <div class="sched-item">
          <div>
            <div class="sched-topic">${esc(item.time)}</div>
            ${(item.group || item.lesson) ? `<div class="sched-meta">${item.group ? `<span>${esc(item.group)}</span>` : ''} ${item.lesson ? `<span>${esc(item.lesson)}</span>` : ''}</div>` : ''}
          </div>
          ${delBtn(subject, 'schedule', item._id)}
        </div>`).join('')}
    </div>`).join('')}
  </div>`;
}

export function renderMarks(subject, data) {
  const el = document.getElementById(`list-${subject}-marks`);
  if (!el) return;

  const filteredData = state.isAdmin ? data : data.filter(d => d.email === state.userEmail);

  if (!filteredData.length) {
    el.innerHTML = `<div class="empty"><i class="ti ti-chart-bar"></i><p>No marks posted yet.</p></div>`;
    return;
  }

  el.innerHTML = `
    <div class="marks-table-wrap">
      <table class="marks-table">
        <thead>
          <tr>
            <th>Quiz / Exam</th>
            ${state.isAdmin ? '<th>Student Email</th>' : ''}
            <th>Mark</th>
            <th>PDF</th>
            ${state.isAdmin ? '<th>Action</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${filteredData.map(item => `
            <tr>
              <td>${esc(item.quiz)}</td>
              ${state.isAdmin ? `<td>${esc(item.email)}</td>` : ''}
              <td><span class="mark-badge">${esc(item.mark)}</span></td>
              <td>
                ${item.pdfUrl
                  ? `<a class="card-link" href="${esc(item.pdfUrl)}" target="_blank" rel="noopener"><i class="ti ti-file-type-pdf"></i> Download</a>`
                  : '<span style="color:var(--ink-text-faint);font-size:12px;">—</span>'}
              </td>
              ${state.isAdmin ? `<td>${delBtn(subject, 'marks', item._id)}</td>` : ''}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

export const RENDERERS = {
  announcements: renderAnnouncements,
  homework: renderHomework,
  notes: renderNotes,
  schedule: renderSchedule,
  marks: renderMarks
};

window.toggleHomework = async (homeworkId, isDone) => {
  if (state.isAdmin) return;
  const studentEmail = state.userEmail;

  const card = document.getElementById(`hw-card-${homeworkId}`);
  if (card) card.classList.toggle('done-card', isDone);

  try {
    const progressRef = doc(db, 'progress', `${studentEmail}_${homeworkId}`);
    if (isDone) {
      await setDoc(progressRef, { done: true, timestamp: serverTimestamp() });
    } else {
      await deleteDoc(progressRef);
    }
    state.studentProgress[homeworkId] = isDone;
    toast(isDone ? 'Marked as done' : 'Marked as due');
  } catch (e) {
    console.error(e);
    toast('Error updating status', 'ti-alert-triangle');
    if (card) card.classList.toggle('done-card', !isDone);
  }
};
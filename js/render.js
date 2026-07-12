import { esc, DAY_ORDER, toast, db } from './config.js';
import { state } from './auth.js';
import { doc, setDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export function delBtn(subject, section, id) {
  return state.isAdmin ? `<button class="del-btn" onclick="window._del('${subject}','${section}','${id}')"><i class="ti ti-trash"></i></button>` : '';
}

export function renderAnnouncements(subject, data) {
  const el = document.getElementById(`list-${subject}-announcements`);
  if (!el) return;
  if (!data.length) { el.innerHTML = `<div class="empty"><i class="ti ti-speakerphone"></i><p>No announcements yet.</p></div>`; return; }
  el.innerHTML = data.map(item => `
    <div class="card ${item.pinned?'pin-card':''}">
      <div class="card-row">
        <div class="card-icon ann"><i class="ti ${item.pinned?'ti-pin':'ti-speakerphone'}"></i></div>
        <div class="card-body">
          <div class="card-title">${esc(item.title)} ${item.badge?`<span class="badge ${esc(item.badge)}">${esc(item.badge)}</span>`:''}</div>
          <div class="card-meta">${esc(item.date)}</div>
          ${item.desc?`<div class="card-desc">${esc(item.desc)}</div>`:''}
        </div>
        ${delBtn(subject,'announcements',item._id)}
      </div>
    </div>`).join('');
}

export function renderRecordings(subject, data) {
  const el = document.getElementById(`list-${subject}-recordings`);
  if (!el) return;
  if (!data.length) { el.innerHTML = `<div class="empty"><i class="ti ti-video"></i><p>No recordings posted yet.</p></div>`; return; }
  el.innerHTML = data.map(item => `
    <div class="card">
      <div class="card-row">
        <div class="card-icon vid"><i class="ti ti-player-play"></i></div>
        <div class="card-body">
          <div class="card-title">${esc(item.title)}</div>
          <div class="card-meta">${esc(item.date)}</div>
          ${item.desc?`<div class="card-desc">${esc(item.desc)}</div>`:''}
          ${item.link?`<a class="card-link" href="${esc(item.link)}" target="_blank" rel="noopener"><i class="ti ti-external-link"></i> Open recording</a>`:''}
        </div>
        ${delBtn(subject,'recordings',item._id)}
      </div>
    </div>`).join('');
}

export function renderHomework(subject, data) {
  const el = document.getElementById(`list-${subject}-homework`);
  if (!el) return;
  if (!data.length) { el.innerHTML = `<div class="empty"><i class="ti ti-notebook"></i><p>No homework posted yet.</p></div>`; return; }
  
  el.innerHTML = data.map(item => {
    const isDone = state.studentProgress?.[item._id] === true;
    return `
      <div class="card ${isDone ? 'done-card' : ''}" id="hw-card-${item._id}">
        <div class="card-row">
          <div class="card-icon hw"><i class="ti ti-notebook"></i></div>
          <div class="card-body">
            <div class="card-title">
              ${esc(item.title)} 
              ${item.badge?`<span class="badge ${esc(item.badge)}">${esc(item.badge)}</span>`:''}
              ${!state.isAdmin ? `<label class="check-label"><input type="checkbox" ${isDone?'checked':''} onchange="window.toggleHomework('${item._id}', this.checked)"> Done</label>` : ''}
            </div>
            <div class="card-meta">${esc(item.date)}</div>
            ${item.desc?`<div class="card-desc">${esc(item.desc)}</div>`:''}
            ${item.link ? `
              <div class="img-preview">
                <img src="${esc(item.link)}" alt="Preview" onclick="window.open('${esc(item.link)}', '_blank')">
              </div>
              <a class="card-link" href="${esc(item.link)}" target="_blank" rel="noopener"><i class="ti ti-download"></i> Download Image</a>
            ` : ''}
          </div>
          ${delBtn(subject,'homework',item._id)}
        </div>
      </div>`;
  }).join('');
}

export function renderNotes(subject, data) {
  const el = document.getElementById(`list-${subject}-notes`);
  if (!el) return;
  if (!data.length) { el.innerHTML = `<div class="empty"><i class="ti ti-file-text"></i><p>No notes posted yet.</p></div>`; return; }
  el.innerHTML = data.map(item => `
    <div class="card">
      <div class="card-row">
        <div class="card-icon note"><i class="ti ti-file-text"></i></div>
        <div class="card-body">
          <div class="card-title">${esc(item.title)}</div>
          <div class="card-meta">${esc(item.date)}</div>
          ${item.desc?`<div class="card-desc">${esc(item.desc)}</div>`:''}
          ${item.link?`<a class="card-link" href="${esc(item.link)}" target="_blank" rel="noopener"><i class="ti ti-external-link"></i> Open file</a>`:''}
        </div>
        ${delBtn(subject,'notes',item._id)}
      </div>
    </div>`).join('');
}

export function renderSchedule(subject, data) {
  const el = document.getElementById(`list-${subject}-schedule`);
  if (!el) return;
  if (!data.length) { el.innerHTML = `<div class="empty"><i class="ti ti-calendar"></i><p>No schedule posted yet.</p></div>`; return; }
  const grouped = {};
  data.forEach(item => { if (!grouped[item.day]) grouped[item.day]=[]; grouped[item.day].push(item); });
  const sorted = Object.keys(grouped).sort((a,b) => DAY_ORDER.indexOf(a)-DAY_ORDER.indexOf(b));
  el.innerHTML = `<div class="sched-grid">${sorted.map(day=>`
    <div class="sched-day">
      <div class="sched-day-name">${esc(day)}</div>
      ${grouped[day].map(item=>`
        <div class="sched-item">
          <div>
            <div class="sched-topic">${esc(item.topic)}</div>
            <div class="sched-time">${esc(item.time)}</div>
            ${(item.group || item.lesson) ? `<div class="sched-meta">${item.group ? `<span>${esc(item.group)}</span>` : ''} ${item.lesson ? `<span>${esc(item.lesson)}</span>` : ''}</div>` : ''}
          </div>
          ${delBtn(subject,'schedule',item._id)}
        </div>`).join('')}
    </div>`).join('')}
  </div>`;
}

export const RENDERERS = { announcements: renderAnnouncements, recordings: renderRecordings, homework: renderHomework, notes: renderNotes, schedule: renderSchedule };

window.toggleHomework = async (homeworkId, isDone) => {
  if (state.isAdmin) return;
  const studentEmail = document.getElementById('user-email-display').textContent;
  
  // Instant UI feedback
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
  } catch(e) {
    console.error(e);
    toast('Error updating status', 'ti-alert-triangle');
    // Revert UI on error
    if (card) card.classList.toggle('done-card', !isDone);
  }
};

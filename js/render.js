import { esc, toast, db } from './config.js';
import { state } from './auth.js';
import { GROUPS, usesGroups, groupOf, cleanLessonTitle, groupLessons, inferGroup, getMyGroup, setMyGroup, cacheHomework, getCachedHomework } from './groups.js';
import { doc, setDoc, deleteDoc, getDoc, getDocs, collection, query, where, documentId, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Week starting from Friday
const WEEK_ORDER_FRIDAY = [
  'Friday',
  'Saturday',
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday'
];

function formatDate(dateStr) {
  if (!dateStr) return '';
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  return dateStr;
}

function parseTime(timeStr) {
  if (!timeStr || timeStr === '—') return Infinity;
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return Infinity;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3] ? match[3].toUpperCase() : null;

  if (period === 'PM' && hours < 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;

  return hours * 60 + minutes;
}

// Admin-only badge for posts that are scheduled for the future
function scheduledBadge(item) {
  if (!state.isAdmin || !item._scheduledFor) return '';
  const when = new Date(item._scheduledFor).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });
  return `<span class="badge" style="background:#fff3cd;color:#8a6d1d;">Scheduled · ${esc(when)}</span>`;
}

export function delBtn(subject, section, id) {
  return state.isAdmin
    ? `<button class="del-btn" onclick="window._del('${subject}','${section}','${id}')"><i class="ti ti-trash"></i></button>`
    : '';
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
          <div class="card-title">
            ${esc(item.title)}
            ${scheduledBadge(item)}
            ${item.badge ? `<span class="badge ${esc(item.badge)}">${esc(item.badge)}</span>` : ''}
          </div>
          <div class="card-meta">${esc(formatDate(item.date))}</div>
          ${item.desc ? `<div class="card-desc">${esc(item.desc)}</div>` : ''}
        </div>
        ${delBtn(subject, 'announcements', item._id)}
      </div>
    </div>
  `).join('');
}

// One homework per LESSON is required (each group gets its own post), so a
// lesson counts as done if the student submitted ANY homework from it.
// Returns true if none of the last 3 lessons has a submission.
//
// Only lessons that are fair to count are looked at:
//   - the deadline (of the student's OWN group) has already passed, so nothing "due tomorrow" counts;
//   - the deadline was NOT already over when the student joined (state.joinedAt, from createdAt / joinedAt
//     on their record), so a new student is not blamed for lessons before they arrived.
function missedLastThreeLessons(data, mySubmissions, subject) {
  const now = Date.now();
  const joined = state.joinedAt || null;
  const myGroup = usesGroups(subject) ? (inferGroup(data, mySubmissions) || getMyGroup(state.userEmail) || '') : '';

  const byKey = {};
  const lessons = [];   // newest first
  for (const item of data) {
    const m = String(item.title || '').match(/(?:Lesson|Lecture|Session)\s*(\d+)/i);
    const key = m ? `lesson-${parseInt(m[1], 10)}` : `single-${item._id}`;
    if (!byKey[key]) {
      byKey[key] = { submitted: false, byGroup: {}, groups: new Set(), groupless: false, deadlines: [] };
      lessons.push(byKey[key]);
    }
    const L = byKey[key];
    if (mySubmissions[item._id]) L.submitted = true;
    const dl = item.deadline ? new Date(item.deadline).getTime() : NaN;
    const g = groupOf(item);
    if (g) {
      L.groups.add(g);
      if (!isNaN(dl)) (L.byGroup[g] = L.byGroup[g] || []).push(dl);
    } else {
      L.groupless = true;
    }
    if (!isNaN(dl)) L.deadlines.push(dl);
  }

  const counted = lessons.filter((L) => {
    let dl;
    if (myGroup && L.byGroup[myGroup] && L.byGroup[myGroup].length) dl = Math.max(...L.byGroup[myGroup]);
    else if (myGroup && L.groups.size > 0 && !L.groupless) return false;     // posted for other groups, not theirs yet
    else dl = L.deadlines.length ? Math.max(...L.deadlines) : null;
    if (dl === null) return false;                                             // no deadline set
    if (dl >= now) return false;                                               // not due yet
    if (joined && dl <= joined) return false;                                  // over before they joined
    return true;
  });

  const lastThree = counted.slice(0, 3);
  return lastThree.length >= 3 && lastThree.every((l) => !l.submitted);
}

// Homework answers attached to a post. Students only get the links once the deadline has passed
// (before that, the links are not even written into the page).
function answersHtml(item, isExpired) {
  const answers = Array.isArray(item.answers) ? item.answers : [];
  if (!answers.length) return '';

  const links = answers.map((a, i) => `
      <a class="card-link" href="${esc(a.url)}" target="_blank" rel="noopener" style="display:block;margin-bottom:4px;">
        <i class="ti ${a.kind === 'pdf' ? 'ti-file-type-pdf' : 'ti-photo'}"></i> ${esc(a.name || 'Answer ' + (i + 1))}
      </a>`).join('');

  if (state.isAdmin) {
    return `
      <div style="margin-top:12px;padding:10px 12px;border-radius:8px;background:var(--chalk-teal-dim);">
        <div style="font-size:12.5px;font-weight:600;margin-bottom:6px;">
          <i class="ti ti-key"></i> Homework answers (${answers.length}) — students see these after the deadline
        </div>${links}
      </div>`;
  }
  if (isExpired) return '';     // after the deadline the answers appear as their own green card (answersCardHtml)
  const when = item.deadline ? ` (${esc(new Date(item.deadline).toLocaleString())})` : '';
  return `
      <div style="margin-top:12px;font-size:12.5px;color:var(--ink-text-faint);">
        <i class="ti ti-lock"></i> Homework answers unlock after the deadline${when}.
      </div>`;
}

// A separate green card that appears once THIS group's deadline has passed, holding the answers.
function answersCardHtml(item) {
  const answers = Array.isArray(item.answers) ? item.answers : [];
  if (state.isAdmin || !answers.length) return '';
  const deadlineMs = item.deadline ? new Date(item.deadline).getTime() : null;
  if (!deadlineMs || Date.now() <= deadlineMs) return '';

  const links = answers.map((a, i) => `
      <a class="card-link" href="${esc(a.url)}" target="_blank" rel="noopener"
         style="display:block;margin-bottom:4px;color:#2e7d32;">
        <i class="ti ${a.kind === 'pdf' ? 'ti-file-type-pdf' : 'ti-photo'}"></i> ${esc(a.name || 'Answer ' + (i + 1))}
      </a>`).join('');

  return `
      <div class="card" id="ans-card-${item._id}" style="background:#e8f5e9;border:1px solid #a5d6a7;color:#1b3a1f;">
        <div class="card-row">
          <div class="card-icon" style="background:#c8e6c9;"><i class="ti ti-circle-check" style="color:#2e7d32;font-size:18px;"></i></div>
          <div class="card-body">
            <div class="card-title">
              Answers: ${esc(cleanLessonTitle(item.title))}
              <span class="badge" style="background:#c8e6c9;color:#1b5e20;">Unlocked</span>
            </div>
            <div class="card-meta">Deadline passed: ${esc(new Date(item.deadline).toLocaleString())}</div>
            <div style="margin-top:8px;">${links}</div>
          </div>
        </div>
      </div>
    `;
}

// One homework card. Admins get one per post; students get one for their own group.
function hwCardHtml(subject, item, { mySub, mySubId, now, displayTitle, extraBadge = '' }) {
  const isDone = state.studentProgress?.[item._id] === true;
  const images = item.images || (item.link ? [item.link] : []);
  const pdfs = item.pdfs || [];

  const deadlineMs = item.deadline ? new Date(item.deadline).getTime() : null;
  const isExpired = deadlineMs ? now > deadlineMs : false;

  return `
      <div class="card ${isDone ? 'done-card' : ''}" id="hw-card-${item._id}">
        <div class="card-row">
          <div class="card-icon hw"><i class="ti ti-notebook"></i></div>
          <div class="card-body">
            <div class="card-title">
              ${esc(displayTitle || item.title)}
              ${scheduledBadge(item)}
              ${extraBadge}
              ${item.hwCode ? `<span class="badge chapter">${esc(item.hwCode)}</span>` : ''}
              ${item.badge ? `<span class="badge ${esc(item.badge)}">${esc(item.badge)}</span>` : ''}
              ${!state.isAdmin ? `
                <label class="check-label">
                  <input type="checkbox" ${isDone ? 'checked' : ''}
                    onchange="window.toggleHomework('${item._id}', this.checked)">
                  Done
                </label>
              ` : ''}
            </div>

            <div class="card-meta">
              ${item.deadline
                ? `Deadline: ${esc(new Date(item.deadline).toLocaleString())}`
                : esc(formatDate(item.date || ''))}
              ${isExpired ? ' • <span style="color:var(--rust);">Closed</span>' : ''}
            </div>

            ${item.desc ? `<div class="card-desc">${esc(item.desc)}</div>` : ''}

            ${images.length ? `
              <div class="hw-files" style="margin-top:10px;">
                ${images.map(url => `
                  <div class="img-preview" style="margin-bottom:8px;">
                    <img src="${esc(url)}" alt="Preview"
                         style="max-width:100%;border-radius:8px;cursor:pointer;"
                         onclick="window.open('${esc(url)}', '_blank')">
                  </div>
                `).join('')}
              </div>
            ` : ''}

            ${pdfs.length ? `
              <div style="margin-top:8px;">
                ${pdfs.map(url => `
                  <a class="card-link" href="${esc(url)}" target="_blank" rel="noopener"
                     style="display:inline-block;margin-right:12px;">
                    <i class="ti ti-file-type-pdf"></i> Download PDF
                  </a>
                `).join('')}
              </div>
            ` : ''}

            ${answersHtml(item, isExpired)}

            ${!state.isAdmin ? `
              <div style="margin-top:14px;" data-submit-area>
                ${mySub ? `
                  <div style="font-size:13px; color:var(--chalk-teal);">
                    <i class="ti ti-check"></i> You already submitted this homework
                    ${mySub.url
                      ? ` — <a href="${esc(mySub.url)}" target="_blank"
                           style="color:var(--chalk-teal);text-decoration:underline;">View your file</a>`
                      : ''}
                    ${!isExpired && mySubId ? `
                      <div style="margin-top:8px;">
                        <button class="btn-cancel" style="padding:5px 12px;font-size:12px;"
                          onclick="window.openReplaceSubmit('${subject}','${mySubId}','${item._id}')">
                          <i class="ti ti-refresh"></i> Replace file
                        </button>
                        <span style="font-size:11px;color:var(--ink-text-faint);margin-left:6px;">until the deadline</span>
                      </div>
                    ` : ''}
                  </div>
                ` : isExpired ? `
                  <div style="font-size:13px; color:var(--rust);">
                    <i class="ti ti-lock"></i> Submission closed (deadline passed)
                  </div>
                ` : `
                  <button class="btn-primary" style="padding:7px 14px;font-size:13px;"
                    onclick="window.openStudentSubmit('${subject}','${item._id}','${esc(item.title)}','${esc(item.hwCode || '')}')">
                    <i class="ti ti-upload"></i> Submit my work
                  </button>
                `}
              </div>
            ` : ''}
          </div>
          ${delBtn(subject, 'homework', item._id)}
        </div>
      </div>
    `;
}

// Student sees this until they choose a group
function pickGroupCardHtml(subject, lesson) {
  const chips = GROUPS.map(g => {
    const posted = !!lesson.byGroup[g];
    return `<button class="btn-cancel" ${posted ? '' : 'disabled title="Not posted yet"'}
      style="padding:6px 12px;font-size:13px;margin:0 6px 6px 0;${posted ? '' : 'opacity:.45;cursor:not-allowed;'}"
      onclick="window.chooseHomeworkGroup('${subject}','${g}')">Group ${esc(g)}</button>`;
  }).join('');

  return `
      <div class="card" id="hw-lesson-${lesson.key}">
        <div class="card-row">
          <div class="card-icon hw"><i class="ti ti-notebook"></i></div>
          <div class="card-body">
            <div class="card-title">${esc(cleanLessonTitle(lesson.items[0]?.title))}</div>
            <div class="card-meta">Your homework and deadline depend on your group</div>
            <div class="card-desc">Which group are you in?</div>
            <div style="margin-top:8px;">${chips}</div>
            <div style="margin-top:10px;" data-submit-area>
              <button class="btn-primary" style="padding:7px 14px;font-size:13px;"
                onclick="window.openGroupPicker('${subject}','${lesson.key}')">
                <i class="ti ti-upload"></i> Submit my work
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
}

// Student's group is known, but their group's post isn't out yet
function waitingCardHtml(subject, lesson, myGroup, changeLink) {
  return `
      <div class="card" id="hw-lesson-${lesson.key}">
        <div class="card-row">
          <div class="card-icon hw"><i class="ti ti-notebook"></i></div>
          <div class="card-body">
            <div class="card-title">
              ${esc(cleanLessonTitle(lesson.items[0]?.title))}
              <span class="badge chapter">Group ${esc(myGroup)}</span>
            </div>
            <div class="card-desc">Your group's homework hasn't been posted yet.</div>
            ${changeLink}
          </div>
        </div>
      </div>
    `;
}

// The student's own submissions, in ONE query instead of one read per homework post (all groups).
// Document ids are "<email>_<homeworkId>". The result is kept for a few minutes and is dropped whenever the
// student submits, replaces or deletes a file (those all call window.rerenderHomework).
let subsCache = null;   // { email, at, byId }
const SUBS_CACHE_MS = 10 * 60 * 1000;

async function loadMySubmissions(data) {
  const email = state.userEmail;
  const out = {};
  const pick = (byId) => { for (const item of data) if (byId[item._id]) out[item._id] = byId[item._id]; return out; };

  if (subsCache && subsCache.email === email && Date.now() - subsCache.at < SUBS_CACHE_MS) return pick(subsCache.byId);

  const prefix = `${email}_`;
  try {
    const q = query(collection(db, 'submissions'), where(documentId(), '>=', prefix), where(documentId(), '<', prefix + '\uf8ff'));
    const snap = await getDocs(q);
    const byId = {};
    snap.forEach((d) => { if (d.id.startsWith(prefix)) byId[d.id.slice(prefix.length)] = d.data(); });
    subsCache = { email, at: Date.now(), byId };
    return pick(byId);
  } catch (e) {
    console.warn('Could not list submissions, checking the posts one by one', e);
    for (const item of data) {
      const snap = await getDoc(doc(db, 'submissions', `${email}_${item._id}`));
      if (snap.exists()) out[item._id] = snap.data();
    }
    return out;
  }
}

export async function renderHomework(subject, data) {
  const el = document.getElementById(`list-${subject}-homework`);
  if (!el) return;

  cacheHomework(subject, data);

  if (!data.length) {
    el.innerHTML = `<div class="empty"><i class="ti ti-notebook"></i><p>No homework posted yet.</p></div>`;
    return;
  }

  let mySubmissions = {};
  if (!state.isAdmin) {
    try {
      mySubmissions = await loadMySubmissions(data);
    } catch (e) {
      console.error('Error loading submissions', e);
    }
  }

  let warningHtml = '';
  if (!state.isAdmin) {
    if (missedLastThreeLessons(data, mySubmissions, subject)) {
      warningHtml = `
        <div style="background:var(--rust-dim); border:1px solid var(--rust-line); color:var(--rust);
                    padding:12px 16px; border-radius:8px; margin-bottom:16px; font-size:13.5px;">
          <strong>Warning:</strong> You have not submitted homework for the last 3 lessons. Please catch up.
        </div>`;
    }
  }

  const now = Date.now();

  // ---- Admin: one card per post, exactly as before ----
  if (state.isAdmin) {
    el.innerHTML = data.map(item => hwCardHtml(subject, item, { mySub: null, now })).join('');
    return;
  }

  // ---- Subjects without groups (e.g. Edexcel): one card per post, as before ----
  if (!usesGroups(subject)) {
    el.innerHTML = warningHtml + data
      .map(item => hwCardHtml(subject, item, { mySub: mySubmissions[item._id], mySubId: item._id, now }) + answersCardHtml(item))
      .join('');
    return;
  }

  // ---- Student: one card per lesson, showing only their own group ----
  const inferred = inferGroup(data, mySubmissions);   // locked once they have submitted
  const locked = !!inferred;
  const myGroup = inferred || getMyGroup(state.userEmail);

  const changeLink = locked ? '' : `
    <div style="margin-top:8px;font-size:12px;">
      <a href="#" onclick="window.clearHomeworkGroup('${subject}');return false;"
         style="color:var(--chalk-teal);text-decoration:underline;">Not your group? Change</a>
    </div>`;

  const cards = groupLessons(data).map(lesson => {
    let html = '';
    const hasGroups = Object.keys(lesson.byGroup).length > 0;

    if (hasGroups) {
      const mine = myGroup ? lesson.byGroup[myGroup] : null;
      const lessonSubItem = lesson.items.find(i => mySubmissions[i._id]);
      const lessonSub = lessonSubItem ? mySubmissions[lessonSubItem._id] : null;

      if (mine) {
        html += hwCardHtml(subject, mine, {
          mySub: lessonSub,
          mySubId: lessonSubItem ? lessonSubItem._id : null,
          now,
          displayTitle: cleanLessonTitle(mine.title),
          extraBadge: `<span class="badge chapter">Group ${esc(myGroup)}</span>` + (locked ? '' : `
            <a href="#" onclick="window.clearHomeworkGroup('${subject}');return false;"
               style="font-size:11px;font-weight:400;color:var(--chalk-teal);text-decoration:underline;">change</a>`)
        });
        html += answersCardHtml(mine);
      } else if (myGroup) {
        html += waitingCardHtml(subject, lesson, myGroup, changeLink);
      } else {
        html += pickGroupCardHtml(subject, lesson);
      }
    }

    // Older posts with no group in the title are shown as plain cards
    lesson.items.filter(i => !groupOf(i)).forEach(item => {
      html += hwCardHtml(subject, item, { mySub: mySubmissions[item._id], mySubId: item._id, now }) + answersCardHtml(item);
    });
    return html;
  });

  el.innerHTML = warningHtml + cards.join('');
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
          <div class="card-title">
            ${esc(item.title)}
            ${scheduledBadge(item)}
            ${item.chapter ? `<span class="badge chapter">${esc(item.chapter)}</span>` : ''}
          </div>
          <div class="card-meta">${esc(formatDate(item.date))}</div>
          ${item.desc ? `<div class="card-desc">${esc(item.desc)}</div>` : ''}
          ${item.link
            ? `<a class="card-link" href="${esc(item.link)}" target="_blank" rel="noopener">
                 <i class="ti ti-external-link"></i> Open file
               </a>`
            : ''}
        </div>
        ${delBtn(subject, 'notes', item._id)}
      </div>
    </div>
  `).join('');
}

export function renderSchedule(subject, data) {
  const el = document.getElementById(`list-${subject}-schedule`);
  if (!el) return;
  if (!data.length) {
    el.innerHTML = `<div class="empty"><i class="ti ti-calendar"></i><p>No schedule posted yet.</p></div>`;
    return;
  }

  const parseLessonNum = (lessonStr) => {
    if (!lessonStr) return Infinity;
    const match = String(lessonStr).match(/\d+/);
    return match ? parseInt(match[0], 10) : Infinity;
  };

  const grouped = {};
  data.forEach(item => {
    if (!grouped[item.day]) grouped[item.day] = [];
    grouped[item.day].push(item);
  });

  // Sort inside each day by Lesson # first, then by Time (AM to PM)
  Object.keys(grouped).forEach(day => {
    grouped[day].sort((a, b) => {
      const lessonDiff = parseLessonNum(a.lesson) - parseLessonNum(b.lesson);
      if (lessonDiff !== 0) return lessonDiff;
      return parseTime(a.time) - parseTime(b.time);
    });
  });

  // Sort day columns starting from Friday
  const sorted = Object.keys(grouped).sort(
    (a, b) => WEEK_ORDER_FRIDAY.indexOf(a) - WEEK_ORDER_FRIDAY.indexOf(b)
  );

  el.innerHTML = `<div class="sched-grid">${sorted.map(day => `
    <div class="sched-day">
      <div class="sched-day-name">${esc(day)}</div>${grouped[day].map(item => `
        <div class="sched-item">
          <div>
            <div class="sched-topic">${esc(item.time)}</div>
            ${(item.group || item.lesson) ? `
              <div class="sched-meta">
                ${item.group ? `<span>${esc(item.group)}</span>` : ''}
                ${item.lesson ? `<span>${esc(item.lesson)}</span>` : ''}
              </div>
            ` : ''}
          </div>
          ${delBtn(subject, 'schedule', item._id)}
        </div>
      `).join('')}
    </div>
  `).join('')}</div>`;
}

export function renderMarks(subject, data) {
  const el = document.getElementById(`list-${subject}-marks`);
  if (!el) return;

  const filteredData = state.isAdmin
    ? data
    : data.filter(d => d.email === state.userEmail);

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
              <td>${esc(item.quiz)}</td>${state.isAdmin ? `<td>${esc(item.email)}</td>` : ''}
              <td><span class="mark-badge">${esc(item.mark)}</span></td>
              <td>
                ${item.pdfUrl
                  ? `<a class="card-link" href="${esc(item.pdfUrl)}" target="_blank" rel="noopener">
                       <i class="ti ti-file-type-pdf"></i> Download
                     </a>`
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

export function renderAttendance(subject, data) {
  const el = document.getElementById(`list-${subject}-attendance`);
  if (!el) return;

  const cleanUserEmail = (state.userEmail || '').toLowerCase().trim();

  const filteredData = state.isAdmin
    ? data
    : data.filter(d => Array.isArray(d.presentEmails) && d.presentEmails.includes(cleanUserEmail));

  if (!filteredData.length) {
    el.innerHTML = `<div class="empty"><i class="ti ti-calendar-check"></i><p>No attendance records logged yet.</p></div>`;
    return;
  }

  el.innerHTML = filteredData.map(item => `
    <div class="card">
      <div class="card-row">
        <div class="card-icon att" style="background:var(--chalk-teal-dim);">
          <i class="ti ti-user-check" style="color:var(--chalk-teal);font-size:18px;"></i>
        </div>
        <div class="card-body">
          <div class="card-title">
            ${esc(item.title || 'Weekly Lesson')}
            <span class="badge done">Present</span>
          </div>
          <div class="card-meta">
            📅 ${esc(formatDate(item.date || ''))}
          </div>
          ${state.isAdmin ? `
            <div class="card-desc" style="margin-top:4px;font-size:12px;color:var(--paper-text-faint);">
              <strong>${item.presentEmails?.length || 0}</strong> students matched
              ${item.unlinkedIds?.length ? ` • <span style="color:var(--rust);">${item.unlinkedIds.length} unlinked IDs</span>` : ''}
            </div>
          ` : ''}
        </div>
        ${delBtn(subject, 'attendance', item._id)}
      </div>
    </div>
  `).join('');
}

export const RENDERERS = {
  announcements: renderAnnouncements,
  homework: renderHomework,
  notes: renderNotes,
  schedule: renderSchedule,
  marks: renderMarks,
  attendance: renderAttendance
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

// ---- Group selection helpers (homework) ----
window.rerenderHomework = (subject) => {
  subsCache = null;            // something may have changed (a submission, a delete, a group choice)
  const cached = getCachedHomework(subject);
  if (cached) renderHomework(subject, cached);
};
window.chooseHomeworkGroup = (subject, group) => {
  setMyGroup(state.userEmail, group);
  window.rerenderHomework(subject);
};
window.clearHomeworkGroup = (subject) => {
  setMyGroup(state.userEmail, '');
  window.rerenderHomework(subject);
};

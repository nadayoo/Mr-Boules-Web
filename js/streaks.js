// Missed-lesson streaks for the admin "Missed Lessons" panel.
// No Firebase code in here, so it is easy to test.
//
// Lessons are counted by LESSON NUMBER only. A student who submitted in the "wrong" group still
// counts as having submitted. The only time groups are looked at is to avoid false alarms: if a
// lesson was posted / held for other groups but not yet for this student's group, that lesson is
// skipped for them instead of being counted as missed.
import { lessonOf, groupOf } from './groups.js';

const SUBJECT_FIELDS = ['subjects', 'subject', 'userSubjects', 'courses', 'course'];

// Which subject(s) a student record belongs to ("olcam", "Cambridge", "oledx", "Edexcel" ...)
export function subjectsOf(data) {
  const out = new Set();
  const values = [];
  for (const f of SUBJECT_FIELDS) {
    const v = data && data[f];
    if (Array.isArray(v)) values.push(...v);
    else if (v) values.push(v);
  }
  for (const v of values) {
    const s = String(v).toLowerCase();
    if (/cam/.test(s)) out.add('olcam');
    if (/edx|edex/.test(s)) out.add('oledx');
  }
  return out;
}

// When the student was added to the portal. A field called joinedAt (set by hand) wins over the automatic ones.
const JOIN_FIELDS = ['joinedAt', 'createdAt', 'importedAt', 'addedAt', 'created', 'imported'];
export function joinedAtOf(data) {
  for (const f of JOIN_FIELDS) {
    const v = data && data[f];
    if (v === undefined || v === null || v === '') continue;
    let ms = null;
    if (typeof v.toMillis === 'function') ms = v.toMillis();                          // Firestore Timestamp
    else if (typeof v === 'object' && typeof v.seconds === 'number') ms = v.seconds * 1000;
    else if (typeof v === 'number') ms = v < 1e11 ? v * 1000 : v;
    else { const t = new Date(v).getTime(); if (!isNaN(t)) ms = t; }
    if (ms !== null && !isNaN(ms)) return ms;
  }
  return null;
}

// The deadline that applies to a student of group g for one lesson:
// a number, null (no deadline set), or undefined (posted for other groups only - skip the lesson)
function deadlineFor(e, g) {
  if (g && e.byGroup[g] && e.byGroup[g].length) return maxOf(e.byGroup[g]);
  if (g && e.groups.size > 0 && !e.groupless) return undefined;
  return maxOf(e.deadlines);
}

export const NEVER = '__never__';      // tabGroup value for "never submitted" / "never attended"

const lc = (e) => String(e || '').trim().toLowerCase();
const maxOf = (a) => (a.length ? Math.max(...a) : null);

function topKey(counts) {
  let best = '', n = 0;
  for (const [k, v] of Object.entries(counts)) if (k && v > n) { best = k; n = v; }
  return best;
}

// The run of missed lessons at the END of the list (the student's current streak)
function trailingRun(lessonsAsc, isMissed) {
  const run = [];
  for (let i = lessonsAsc.length - 1; i >= 0; i--) {
    if (isMissed(lessonsAsc[i])) run.unshift(lessonsAsc[i]);
    else break;
  }
  return run;
}

// n missed in a row -> what to show. A warning that an admin already ticked for this streak stays hidden;
// a third miss turns it into "contact".
function levelFor(run, ack) {
  const n = run.length;
  if (n >= 3) return 'contact';
  if (n === 2) {
    const last = run[run.length - 1];
    if (ack && ack.warnedThrough != null && ack.warnedThrough >= last) return null;   // warning already sent
    return 'warn';
  }
  return null;
}

// "Parents contacted" gives a clean slate: only lessons AFTER that point count again.
function afterReset(lessonsAsc, ack) {
  return ack && ack.contactedThrough != null ? lessonsAsc.filter((L) => L > ack.contactedThrough) : lessonsAsc;
}

// acks = { homework: { email: { warnedThrough, contactedThrough } }, attendance: { ... } }
export function computeStreaks({ subject, students, posts, submissions, attendance, acks = {}, now = Date.now() }) {
  // ---------- who to check ----------
  const all = [];
  const seen = new Set();
  for (const s of students) {
    const email = lc(s.email);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    all.push({ raw: s, email, id: String(s.id || '').trim() });
  }
  const anyHasSubject = all.some((s) => subjectsOf(s.raw).size > 0);

  // ---------- homework: lessons, per-group deadlines ----------
  const postLesson = {};
  const hw = {};                                   // lesson -> { byGroup:{g:[deadlines]}, groups:Set, groupless, deadlines:[] }
  for (const p of posts) {
    const L = lessonOf(p);
    if (L === null) continue;
    postLesson[p._id] = L;
    const e = (hw[L] = hw[L] || { byGroup: {}, groups: new Set(), groupless: false, deadlines: [] });
    const dl = p.deadline ? new Date(p.deadline).getTime() : NaN;
    const g = groupOf(p);
    if (g) { e.groups.add(g); e.byGroup[g] = e.byGroup[g] || []; if (!isNaN(dl)) e.byGroup[g].push(dl); }
    else e.groupless = true;
    if (!isNaN(dl)) e.deadlines.push(dl);
  }

  // ---------- submissions: lessons per student (any group counts) ----------
  const submittedLessons = {};
  const groupVotes = {};
  const submitVotes = {};                           // group votes from SUBMISSIONS only (the Homework tab's groups)
  const attVotes = {};                              // group votes from ATTENDANCE only (the Attendance tab's groups)
  const submittedEmails = new Set();                // ever submitted any homework
  const attendedEmails = new Set();                 // ever present at any session
  const vote = (email, g) => {
    if (!g) return;
    groupVotes[email] = groupVotes[email] || {};
    groupVotes[email][g] = (groupVotes[email][g] || 0) + 1;
  };
  const activeEmails = new Set();
  for (const s of submissions) {
    const email = lc(s.email);
    if (!email) continue;
    submittedEmails.add(email);
    const L = postLesson[s.homeworkId] ?? lessonOf({ title: s.homeworkTitle });
    if (L !== null && L !== undefined) (submittedLessons[email] = submittedLessons[email] || new Set()).add(L);
    const sg = lc(s.group) || groupOf({ title: s.homeworkTitle });
    vote(email, sg);
    if (sg) { submitVotes[email] = submitVotes[email] || {}; submitVotes[email][sg] = (submitVotes[email][sg] || 0) + 1; }
    activeEmails.add(email);
  }

  // ---------- attendance ----------
  const att = {};                                   // lesson -> { groups:Set, groupless, present:Set }
  for (const a of attendance) {
    for (const raw of a.presentEmails || []) { const em = lc(raw); if (em) attendedEmails.add(em); }
    const L = lessonOf({ title: a.title });
    if (L === null) continue;
    const e = (att[L] = att[L] || { groups: new Set(), groupless: false, present: new Set() });
    const g = groupOf({ title: a.title });
    if (g) e.groups.add(g); else e.groupless = true;
    for (const raw of a.presentEmails || []) {
      const email = lc(raw);
      if (!email) continue;
      e.present.add(email);
      vote(email, g);
      if (g) { attVotes[email] = attVotes[email] || {}; attVotes[email][g] = (attVotes[email][g] || 0) + 1; }
      activeEmails.add(email);
    }
  }

  // ---------- roster ----------
  let roster;
  let rosterFallback = false;
  let noSubject = 0;
  if (anyHasSubject) {
    roster = all.filter((s) => {
      const subs = subjectsOf(s.raw);
      if (!subs.size) { noSubject++; return false; }
      return subs.has(subject);
    });
  } else {
    rosterFallback = true;                          // couldn't read a subject: use students seen in this subject
    roster = all.filter((s) => activeEmails.has(s.email));
  }

  // ---------- streaks ----------
  const homework = [];
  const attendance_ = [];

  for (const s of roster) {
    const g = topKey(groupVotes[s.email] || {});
    // Tabs in the panel. Homework and attendance are kept completely apart here:
    //   Homework tab   -> the group on the student's homework submissions, or NEVER if they never submitted
    //   Attendance tab -> the group of the sessions they attended, or NEVER if they never attended
    // ('g' above, which mixes both, is only used to pick the right deadline / session for the counting)
    const hwTabGroup = submittedEmails.has(s.email) ? topKey(submitVotes[s.email] || {}) : NEVER;
    const attTabGroup = attendedEmails.has(s.email) ? topKey(attVotes[s.email] || {}) : NEVER;

    // homework
    // Lessons whose deadline was already over when the student joined do not count for them
    // (and neither does the attendance of those lessons).
    const joined = joinedAtOf(s.raw);
    let cutoff = 0;
    if (joined !== null) {
      for (const [Ls, e] of Object.entries(hw)) {
        const dl = deadlineFor(e, g);
        if (dl !== undefined && dl !== null && dl <= joined) cutoff = Math.max(cutoff, Number(Ls));
      }
    }

    const hwLessons = [];
    for (const [Ls, e] of Object.entries(hw)) {
      if (Number(Ls) <= cutoff) continue;                               // before they joined
      const dl = deadlineFor(e, g);
      if (dl === undefined) continue;                                   // posted for other groups, not this one yet
      if (dl !== null && dl < now) hwLessons.push(Number(Ls));          // THEIR group's deadline has passed
    }
    hwLessons.sort((a, b) => a - b);
    const mySubmitted = submittedLessons[s.email] || new Set();
    const hwAck = (acks.homework || {})[s.email];
    const hwRun = trailingRun(afterReset(hwLessons, hwAck), (L) => !mySubmitted.has(L));
    const hwLevel = levelFor(hwRun, hwAck);
    if (hwLevel) homework.push({ id: s.id, email: s.email, group: g, tabGroup: hwTabGroup, run: hwRun, count: hwRun.length, last: hwRun[hwRun.length - 1], level: hwLevel });

    // attendance
    const attLessons = [];
    for (const [Ls, e] of Object.entries(att)) {
      if (Number(Ls) <= cutoff) continue;                                          // before they joined
      if (g && e.groups.size > 0 && !e.groups.has(g) && !e.groupless) continue;   // their group's session not uploaded
      attLessons.push(Number(Ls));
    }
    attLessons.sort((a, b) => a - b);
    const attAck = (acks.attendance || {})[s.email];
    const attRun = trailingRun(afterReset(attLessons, attAck), (L) => !att[L].present.has(s.email));
    const attLevel = levelFor(attRun, attAck);
    if (attLevel) attendance_.push({ id: s.id, email: s.email, group: g, tabGroup: attTabGroup, run: attRun, count: attRun.length, last: attRun[attRun.length - 1], level: attLevel });
  }

  const order = (a, b) =>
    (a.level === b.level ? 0 : a.level === 'contact' ? -1 : 1) ||
    b.count - a.count ||
    String(a.id).localeCompare(String(b.id));
  homework.sort(order);
  attendance_.sort(order);

  return {
    homework,
    attendance: attendance_,
    meta: { checked: roster.length, rosterFallback, noSubject, hwLessons: Object.keys(hw).length, attLessons: Object.keys(att).length },
  };
}

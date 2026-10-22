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
  const vote = (email, g) => {
    if (!g) return;
    groupVotes[email] = groupVotes[email] || {};
    groupVotes[email][g] = (groupVotes[email][g] || 0) + 1;
  };
  const activeEmails = new Set();
  for (const s of submissions) {
    const email = lc(s.email);
    if (!email) continue;
    const L = postLesson[s.homeworkId] ?? lessonOf({ title: s.homeworkTitle });
    if (L !== null && L !== undefined) (submittedLessons[email] = submittedLessons[email] || new Set()).add(L);
    vote(email, lc(s.group) || groupOf({ title: s.homeworkTitle }));
    activeEmails.add(email);
  }

  // ---------- attendance ----------
  const att = {};                                   // lesson -> { groups:Set, groupless, present:Set }
  for (const a of attendance) {
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

    // homework
    const hwLessons = [];
    for (const [Ls, e] of Object.entries(hw)) {
      let dl;
      if (g && e.byGroup[g] && e.byGroup[g].length) dl = maxOf(e.byGroup[g]);
      else if (g && e.groups.size > 0 && !e.groupless) continue;        // posted for other groups, not this one yet
      else dl = maxOf(e.deadlines);
      if (dl !== null && dl < now) hwLessons.push(Number(Ls));          // deadline passed
    }
    hwLessons.sort((a, b) => a - b);
    const mySubmitted = submittedLessons[s.email] || new Set();
    const hwAck = (acks.homework || {})[s.email];
    const hwRun = trailingRun(afterReset(hwLessons, hwAck), (L) => !mySubmitted.has(L));
    const hwLevel = levelFor(hwRun, hwAck);
    if (hwLevel) homework.push({ id: s.id, email: s.email, run: hwRun, count: hwRun.length, last: hwRun[hwRun.length - 1], level: hwLevel });

    // attendance
    const attLessons = [];
    for (const [Ls, e] of Object.entries(att)) {
      if (g && e.groups.size > 0 && !e.groups.has(g) && !e.groupless) continue;   // their group's session not uploaded
      attLessons.push(Number(Ls));
    }
    attLessons.sort((a, b) => a - b);
    const attAck = (acks.attendance || {})[s.email];
    const attRun = trailingRun(afterReset(attLessons, attAck), (L) => !att[L].present.has(s.email));
    const attLevel = levelFor(attRun, attAck);
    if (attLevel) attendance_.push({ id: s.id, email: s.email, run: attRun, count: attRun.length, last: attRun[attRun.length - 1], level: attLevel });
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

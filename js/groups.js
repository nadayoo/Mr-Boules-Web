// Group-aware homework helpers (no Firebase imports, so this is easy to test)

// Groups that get homework. Add/remove here if your groups change.
export const GROUPS = ['1', '2', '3', '5'];

// Only these subjects use the group system. Everything else (e.g. Edexcel)
// keeps the original one-post-per-homework behaviour.
const GROUP_SUBJECTS = ['olcam'];
export function usesGroups(subject) {
  return GROUP_SUBJECTS.includes(subject);
}

export function lessonOf(item) {
  if (item && item.lesson !== undefined && item.lesson !== null && item.lesson !== '') {
    const n = parseInt(item.lesson, 10);
    if (!isNaN(n)) return n;
  }
  const m = String((item && item.title) || '').match(/(?:Lesson|Lecture|Session)\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

export function groupOf(item) {
  if (item && item.group !== undefined && item.group !== null && String(item.group).trim() !== '') {
    return String(item.group).trim().toLowerCase();
  }
  const m = String((item && item.title) || '').match(/Group\s*([A-Za-z0-9]+)/i);
  return m ? m[1].toLowerCase() : '';
}

// "Lesson 1, Group 5: Homework 1" -> "Lesson 1: Homework 1"
export function cleanLessonTitle(title) {
  return String(title || '').replace(/,?\s*Group\s*[A-Za-z0-9]+/i, '').replace(/\s+/g, ' ').trim();
}

// Groups posts (newest first) into lessons: { key, lesson, items, byGroup }
export function groupLessons(data) {
  const lessons = [];
  const map = {};
  for (const item of data) {
    const n = lessonOf(item);
    const key = n !== null ? `lesson-${n}` : `single-${item._id}`;
    if (!map[key]) {
      map[key] = { key, lesson: n, items: [], byGroup: {} };
      lessons.push(map[key]);
    }
    const L = map[key];
    L.items.push(item);
    const g = groupOf(item);
    if (g && !L.byGroup[g]) L.byGroup[g] = item;
  }
  return lessons;
}

// A student's group = the group of any homework they already submitted
export function inferGroup(data, mySubmissions) {
  for (const item of data) {
    const sub = mySubmissions[item._id];
    if (sub) {
      // The record's own group wins (admins can correct it); older records fall back to the post's group
      const own = sub.group ? String(sub.group).trim().toLowerCase() : '';
      const g = own || groupOf(item);
      if (g) return g;
    }
  }
  return '';
}

// Admin "Fix Groups": which submission records would change if the student moved to `target`
// subs = [{ postId, data }]   posts = homework posts
export function planGroupSwitch(posts, subs, target) {
  const t = String(target).trim().toLowerCase();
  const changes = [];
  const unchanged = [];
  for (const s of subs) {
    const post = posts.find((p) => p._id === s.postId) || null;
    const ref = post || { title: s.data.homeworkTitle };
    const lesson = lessonOf(ref);
    const from = (s.data.group ? String(s.data.group).trim().toLowerCase() : '') || groupOf(ref);
    if (from === t) { unchanged.push({ postId: s.postId, lesson, group: from }); continue; }
    const targetPost = posts.find((p) => lessonOf(p) === lesson && groupOf(p) === t) || null;
    const oldTitle = String(s.data.homeworkTitle || (post && post.title) || '');
    const newTitle = targetPost
      ? targetPost.title
      : oldTitle.replace(/Group\s*[A-Za-z0-9]+/i, `Group ${t}`);
    changes.push({ postId: s.postId, lesson, from, to: t, hasTargetPost: !!targetPost, newTitle });
  }
  return { changes, unchanged };
}

// ---- remembered choice (before the first submission) ----
const storageKey = (email) => `bm_group_${String(email || '').toLowerCase()}`;
export function getMyGroup(email) {
  try { return localStorage.getItem(storageKey(email)) || ''; } catch (e) { return ''; }
}
export function setMyGroup(email, group) {
  try {
    if (group) localStorage.setItem(storageKey(email), String(group));
    else localStorage.removeItem(storageKey(email));
  } catch (e) {}
}

// ---- cache of the homework list per subject (so modals can look things up) ----
const cache = {};
export function cacheHomework(subject, data) { cache[subject] = data; }
export function getCachedHomework(subject) { return cache[subject]; }
export function getLesson(subject, key) {
  return groupLessons(cache[subject] || []).find((l) => l.key === key);
}
// All homework doc ids that belong to the same lesson as homeworkId
export function lessonItemIds(subject, homeworkId) {
  const lesson = groupLessons(cache[subject] || []).find((l) => l.items.some((i) => i._id === homeworkId));
  return lesson ? lesson.items.map((i) => i._id) : [homeworkId];
}

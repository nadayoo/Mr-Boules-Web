// Timed posts: hides items whose publishAt is in the future from students.
// Admins still see everything (with a "Scheduled" badge).

// Sections that support "Publish at"
export const SCHEDULABLE = ['announcements', 'homework', 'notes'];

function toMs(v) {
  if (!v) return null;
  if (typeof v.toMillis === 'function') return v.toMillis(); // Firestore Timestamp
  const ms = new Date(v).getTime();
  return isNaN(ms) ? null : ms;
}

// Returns the list to display: filtered for students, sorted by publish time.
export function prepareList(section, items, isAdmin, now = Date.now()) {
  if (!SCHEDULABLE.includes(section)) return items;

  const out = [];
  for (const item of items) {
    const pubMs = toMs(item.publishAt);
    const future = pubMs !== null && pubMs > now;
    if (future && !isAdmin) continue;           // hidden from students
    out.push(future ? { ...item, _scheduledFor: pubMs } : item);
  }

  // Newest first, by publish time (falls back to creation time)
  const eff = (it) => toMs(it.publishAt) ?? toMs(it.createdAt) ?? now;
  out.sort((a, b) => eff(b) - eff(a));
  return out;
}

// Used by the timer so we only re-render when something actually changed.
export function listSignature(list, now = Date.now()) {
  return list
    .map((i) => {
      const dl = i.deadline ? new Date(i.deadline).getTime() : null;
      // '!' = deadline passed, so the card is redrawn the moment it passes
      return i._id + (i._scheduledFor ? '*' : '') + (dl && now > dl ? '!' : '');
    })
    .join('|');
}

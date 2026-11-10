import { esc } from './config.js';

// "nada@admin.com" -> "Nada"
export function posterName(email) {
  const local = String(email || '').split('@')[0].replace(/[^A-Za-z0-9]+/g, ' ').trim();
  return local ? local.charAt(0).toUpperCase() + local.slice(1).toLowerCase() : '';
}

// The same name always gets the same colour
function hueOf(name) {
  let h = 0;
  for (const c of String(name).toLowerCase()) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

// Admin-only coloured tag with the name of the assistant who posted the card.
// Old cards (posted before this existed) have no postedBy, so they get no tag.
export function posterTagHtml(item, isAdmin) {
  if (!isAdmin || !item || !item.postedBy) return '';
  const name = posterName(item.postedBy);
  if (!name) return '';
  const h = hueOf(name);
  return `<span class="badge poster-tag" title="Posted by ${esc(item.postedBy)}" style="background:hsl(${h}, 65%, 92%);color:hsl(${h}, 55%, 30%);">${esc(name)}</span>`;
}

// Firestore Timestamp / Date / ISO string / number -> milliseconds (or null)
function toMs(v) {
  if (v == null) return null;
  if (typeof v.toMillis === 'function') return v.toMillis();
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return isNaN(t) ? null : t;
}

// A timed post becomes visible at publishAt, so that is when students "got" it
export function postedAtMs(item) {
  if (!item) return null;
  return toMs(item.publishAt) ?? toMs(item.createdAt);
}

// Grey text under the card, seen by everyone. Nothing if the time is not known yet
// (a brand-new post has no server time for a moment).
export function postedAtHtml(item) {
  const ms = postedAtMs(item);
  if (ms == null) return '';
  const when = new Date(ms).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
  });
  return `<div class="card-posted">Posted at: ${esc(when)}</div>`;
}

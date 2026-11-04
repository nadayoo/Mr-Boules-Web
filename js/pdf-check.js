// Checks on a student's homework PDF, run in THEIR browser when they submit (nothing is sent anywhere else).
// pdf.js is loaded from a CDN only when a student actually submits.
//
// Two things are looked for:
//   1. "empty"  : no page has any writing (a blank page, or a blank document).
//   2. "copy"   : the file is just the homework sheet itself with nothing added. Every page of it matches a page of the
//                 question PDF that the teacher attached, and no page has any extra writing on top.
//                 This mostly catches the sheet uploaded as it is (download -> upload). A re-printed, re-scaled or scanned
//                 copy does not line up with the original and is NOT recognised: it is simply not flagged.
// Both are only FLAGS: the student is asked "submit anyway?" and the teacher sees the file in the Blank files panel.
// If anything goes wrong (pdf.js can't load, the question PDF can't be fetched, odd PDF, too slow) the result is
// { ok: false } or the comparison is skipped, and the student is NOT stopped.

const PDFJS_VERSION = '3.11.174';
const PDFJS_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.js`;
const PDFJS_WORKER = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;

export const BLANK_INK_PCT = 0.03;      // a page with less ink than this (% of its pixels) counts as empty
export const EXTRA_INK_PCT = 0.012;     // writing added on top of the question sheet (all pages together, as % of one page) that counts as "answered".
                                        // One short written answer is about 0.016%, so even a single answer counts as work
const PAGE_WIDTH_PX = 600;              // pages are drawn about this wide
const MAX_PAGES = 30;                   // pages of the student's file that are looked at
const MAX_REF_PAGES = 30;               // pages of the question PDF(s) that are looked at
const MATCH_COVER = 0.5;                // a page "is" a question page if at least this much of the question page's ink is on it
const DILATE = 1;                       // how far (in grid cells, about 2 px) the question ink is allowed to be off. Kept small so writing
                                        // on the printed answer lines is still seen as writing
const TIMEOUT_MS = 30000;

export const BLANK_PROMPT = 'This file looks empty: no writing was found on any page.\n\nSubmit it anyway?';
export const COPY_PROMPT = 'This file looks like the homework sheet itself, with no answers added.\n\nSubmit it anyway?';
export const DUP_PROMPT = 'This exact file has already been submitted by another student.\n\nPlease submit your own work. Submit it anyway?';
export const promptFor = (check) => (check && check.kind === 'copy' ? COPY_PROMPT : BLANK_PROMPT);

// ---------------------------------------------------------------- pixels
// Ink map of one page. data = RGBA pixels. Paper colour = the middle brightness of the page.
// Two cut-offs are used on purpose:
//   - "stable"  (paper - 55, never above 195): used to compare with the question sheet. Pale colours such as a light green
//               box are not ink, so a re-saved copy gives the same map.
//   - "faint"   (paper - 35, never above 215): used to decide if a page is EMPTY. More sensitive, so light pencil is still
//               seen as writing and a page with pencil on it is not wrongly called empty.
// Returns { mask (1 = stable ink), count, pct (stable), faintPct }.
export function inkMask(data, width, height) {
  const total = width * height;
  const mask = new Uint8Array(total);
  if (!total) return { mask, count: 0, pct: 0, faintPct: 0 };
  const lum = new Uint8Array(total);
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; p < total; i += 4, p++) {
    const l = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    lum[p] = l;
    hist[l | 0]++;
  }
  let acc = 0, paper = 255;
  for (let b = 0; b < 256; b++) { acc += hist[b]; if (acc >= total / 2) { paper = b; break; } }
  if (paper < 120) { mask.fill(1); return { mask, count: total, pct: 100, faintPct: 100 }; }   // a mostly dark page is not an empty page
  const cut = Math.min(paper - 55, 195);
  const faintCut = Math.min(paper - 35, 215);
  let count = 0, faint = 0;
  for (let p = 0; p < total; p++) {
    const l = lum[p];
    if (l < cut) { mask[p] = 1; count++; }
    if (l < faintCut) faint++;
  }
  return { mask, count, pct: (count / total) * 100, faintPct: (faint / total) * 100 };
}

export function inkPercent(data, width, height) { return inkMask(data, width, height).faintPct; }

// Halve the size (a cell is ink if any of its 4 pixels is), so small shifts and noise matter less
function shrink(mask, w, h) {
  const w2 = Math.ceil(w / 2), h2 = Math.ceil(h / 2);
  const out = new Uint8Array(w2 * h2);
  let count = 0;
  for (let y = 0; y < h; y++) {
    const row = y * w, orow = (y >> 1) * w2;
    for (let x = 0; x < w; x++) if (mask[row + x] && !out[orow + (x >> 1)]) { out[orow + (x >> 1)] = 1; count++; }
  }
  return { cells: out, w: w2, h: h2, count };
}

// Every cell within r cells of an ink cell (separable, using running sums)
function dilate(cells, w, h, r) {
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let s = 0;
    for (let x = 0; x < Math.min(r, w); x++) s += cells[o + x];
    for (let x = 0; x < w; x++) {
      if (x + r < w) s += cells[o + x + r];
      if (x - r - 1 >= 0) s -= cells[o + x - r - 1];
      tmp[o + x] = s > 0 ? 1 : 0;
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = 0; y < Math.min(r, h); y++) s += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      if (y + r < h) s += tmp[(y + r) * w + x];
      if (y - r - 1 >= 0) s -= tmp[(y - r - 1) * w + x];
      out[y * w + x] = s > 0 ? 1 : 0;
    }
  }
  return out;
}

const dilOf = (p) => p._dil || (p._dil = dilate(p.cells, p.w, p.h, DILATE));

// Which question page does this student page belong to, and how much ink is on it that is NOT on that page?
// Returns { j, extra } or null when no question page matches (so the page is something else).
// `hint` = the index to try first (same page number), which is almost always right.
export function matchPage(S, ref, hint = 0) {
  const order = [hint, ...ref.map((_, j) => j).filter((j) => j !== hint)];
  const total = S.w * S.h;
  let best = null;
  for (const j of order) {
    const R = ref[j];
    if (!R || R.w !== S.w || R.h !== S.h) continue;                  // not the same page size
    if (S.count < R.count * MATCH_COVER) continue;                   // far less ink than that question page
    const rd = dilOf(R);
    let extra = 0;
    for (let k = 0; k < S.cells.length; k++) if (S.cells[k] && !rd[k]) extra++;
    const sd = dilOf(S);
    let covered = 0;
    for (let k = 0; k < R.cells.length; k++) if (R.cells[k] && sd[k]) covered++;
    if (covered < R.count * MATCH_COVER) continue;                   // the question page's content is not on this page
    if (!best || extra < best.extra) best = { j, extra };
    if (j === hint && (extra / total) * 100 < EXTRA_INK_PCT / 4) break;   // clearly the same page with nothing added
  }
  return best;
}

// extra ink of the matched pages together, as a % of ONE page
const pctOf = (sumExtra, sumCells, pages) => (pages ? (sumExtra / (sumCells / pages)) * 100 : 0);

// Is every page of the student's file a question page with nothing added?
// sub / ref = lists of { cells, w, h, count }. Returns { copy, matched, extraPct, reason }.
export function matchesReference(sub, ref) {
  let matched = 0, sumExtra = 0, sumCells = 0;
  for (let i = 0; i < sub.length; i++) {
    const S = sub[i];
    if ((S.count / (S.w * S.h)) * 100 < BLANK_INK_PCT) continue;      // an empty page in between: ignore it
    const best = matchPage(S, ref, Math.min(i, ref.length - 1));
    if (!best) return { copy: false, matched, extraPct: pctOf(sumExtra, sumCells, matched), reason: 'page-not-in-question-sheet' };
    matched++;
    sumExtra += best.extra;
    sumCells += S.w * S.h;
    if (pctOf(sumExtra, sumCells, matched) >= EXTRA_INK_PCT) return { copy: false, matched, extraPct: pctOf(sumExtra, sumCells, matched), reason: 'writing-added' };
  }
  return { copy: matched >= 1, matched, extraPct: pctOf(sumExtra, sumCells, matched), reason: matched ? 'copy' : 'no-ink' };
}

// ---------------------------------------------------------------- pdf.js
let pdfjsPromise = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!pdfjsPromise) {
    pdfjsPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PDFJS_URL;
      s.onload = () => {
        const lib = window.pdfjsLib;
        if (!lib) { pdfjsPromise = null; reject(new Error('pdf.js did not load')); return; }
        lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        resolve(lib);
      };
      s.onerror = () => { pdfjsPromise = null; reject(new Error('could not download pdf.js')); };
      document.head.appendChild(s);
    });
  }
  return pdfjsPromise;
}

const withTimeout = (promise, ms) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), ms)),
]);

// Draws one page about PAGE_WIDTH_PX wide and returns its ink map
async function renderInk(page) {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(2, PAGE_WIDTH_PX / base.width) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const ink = inkMask(img.data, canvas.width, canvas.height);
  if (page.cleanup) page.cleanup();
  return { pct: ink.faintPct, small: shrink(ink.mask, canvas.width, canvas.height) };
}

// ---- the question sheet(s) the teacher attached
// The PDF is downloaded with fetch() so that a failure has a clear reason. It needs the storage bucket to allow reads from
// the site (CORS); if it doesn't, the comparison is skipped and only the empty-file check is done.
const refCache = new Map();                 // url -> rendered question pages, kept for this page visit
let warnedRef = false;

export class RefError extends Error {}
async function fetchBytes(url, fetchFn) {
  let res;
  try { res = await fetchFn(url, { credentials: 'omit' }); }
  catch (e) { throw new RefError('blocked-or-offline'); }          // the browser reports a CORS block and a lost connection the same way
  if (!res.ok) throw new RefError(`http-${res.status}`);
  return res.arrayBuffer();
}

async function loadReference(pdfjs, urls, fetchFn) {
  const out = [];
  let error = '';
  for (const url of urls) {
    try {
      if (!refCache.has(url)) {
        const pdf = await pdfjs.getDocument({ data: await fetchBytes(url, fetchFn) }).promise;
        const pages = [];
        for (let p = 1; p <= pdf.numPages && pages.length < MAX_REF_PAGES; p++) pages.push((await renderInk(await pdf.getPage(p))).small);
        refCache.set(url, pages);
      }
      for (const pg of refCache.get(url)) if (out.length < MAX_REF_PAGES) out.push(pg);
    } catch (e) { error = (e instanceof RefError && e.message) || String((e && e.message) || e); }
  }
  if (!out.length && urls.length && !warnedRef) {
    warnedRef = true;
    console.warn(`[pdf-check] The question PDF could not be read (${error}). Only the empty-file check is running. ` +
      'If the reason is "blocked-or-offline", the storage bucket probably needs its CORS setting.');
  }
  return { pages: out.length ? out : null, error: out.length ? '' : error };
}

export function clearReferenceCache() { refCache.clear(); warnedRef = false; }

// Used by the admin panel: can this browser read a question PDF from storage? -> { ok } or { ok: false, reason }
export async function testReferenceAccess(url, { fetchFn = (typeof fetch === 'function' ? fetch : null) } = {}) {
  try {
    const res = await fetchFn(url, { credentials: 'omit', headers: { Range: 'bytes=0-0' } });
    return res.ok ? { ok: true } : { ok: false, reason: `http-${res.status}` };
  } catch (e) {
    return { ok: false, reason: 'blocked-or-offline' };
  }
}

// -> { ok: true, blank, kind: 'empty'|'copy'|null, pages, checked, inkPct, extraPct?, ref, refError? }  or  { ok: false, error }
// `lib` and `fetchFn` are only for tests. `references` = URLs of the question PDF(s) of this homework.
export async function analyzePdf(file, { lib = null, fetchFn = (typeof fetch === 'function' ? fetch : null), references = [], timeoutMs = TIMEOUT_MS } = {}) {
  try {
    return await withTimeout((async () => {
      const pdfjs = lib || await loadPdfJs();
      const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
      const n = Math.min(pdf.numPages, MAX_PAGES);

      let ref = null, refError = '';
      const wanted = (references || []).filter(Boolean);
      if (wanted.length) ({ pages: ref, error: refError } = await loadReference(pdfjs, wanted, fetchFn));
      const compare = !!ref && pdf.numPages <= ref.length + 2;          // a much longer file is real work, not a copy
      const refState = !wanted.length ? 'none' : (!ref ? 'unavailable' : (compare ? 'used' : 'skipped'));

      // Page by page. With a question sheet to compare to, it stops at the first page that has writing which is not
      // part of the sheet (real work) or as soon as enough extra writing has been seen.
      let best = 0, checked = 0, matched = 0, sumExtra = 0, sumCells = 0, answered = false;
      for (let p = 1; p <= n; p++) {
        const r = await renderInk(await pdf.getPage(p));
        checked++;
        best = Math.max(best, r.pct);
        if (!compare) { if (best >= BLANK_INK_PCT) break; continue; }
        if (r.pct < BLANK_INK_PCT) continue;                            // an empty page in between
        const m = matchPage(r.small, ref, Math.min(p - 1, ref.length - 1));
        if (!m) { answered = true; break; }                              // a page that is not on the sheet = real work
        matched++;
        sumExtra += m.extra;
        sumCells += r.small.w * r.small.h;
        if (pctOf(sumExtra, sumCells, matched) >= EXTRA_INK_PCT) { answered = true; break; }
      }
      const extraPct = Math.round(pctOf(sumExtra, sumCells, matched) * 1000) / 1000;
      const base = { ok: true, pages: pdf.numPages, checked, inkPct: Math.round(best * 1000) / 1000, ref: refState };
      if (refError && refState === 'unavailable') base.refError = refError;
      if (best < BLANK_INK_PCT) return { ...base, blank: true, kind: 'empty' };
      if (compare) {
        if (!answered && matched >= 1) return { ...base, blank: true, kind: 'copy', extraPct };
        return { ...base, blank: false, kind: null, extraPct };
      }
      return { ...base, blank: false, kind: null };
    })(), timeoutMs);
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// SHA-256 fingerprint of the file's bytes, as hex (the same value the server works out for the stored file).
// null when the browser can't do it. Used to ask the student "this exact file was already submitted".
export async function fileSha256(file) {
  try {
    if (!(globalThis.crypto && globalThis.crypto.subtle)) return null;
    const digest = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch (e) { return null; }
}

// The fields saved on the submission document
export function blankFields(check) {
  if (check && check.ok) {
    const info = { pages: check.pages, checked: check.checked, inkPct: check.inkPct, ref: check.ref };
    if (check.refError) info.refError = check.refError;
    if (check.blank) info.kind = check.kind;
    if (check.extraPct !== undefined) info.extraPct = check.extraPct;
    return { blank: !!check.blank, blankInfo: info };
  }
  return { blank: false, blankInfo: { unchecked: true } };
}

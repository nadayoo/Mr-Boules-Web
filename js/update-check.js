// Notices when a new version of the site has been deployed and reloads the page.
// Students who keep a tab open for hours would otherwise keep running old code.
import { APP_VERSION } from './version.js';

const CHECK_EVERY_MS = 2 * 60 * 1000;      // every 2 minutes, and whenever the tab is shown again

async function fetchLatest() {
  const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return null;
  const data = await res.json();
  return data.version || null;
}

// Don't reload while someone is in the middle of something
function isBusy() {
  const overlay = document.getElementById('overlay');
  if (overlay && overlay.classList.contains('open')) return true;          // a pop-up / upload is open
  const email = document.getElementById('login-email');
  const id = document.getElementById('login-id');
  if ((email && email.value) || (id && id.value)) return true;             // typing on the login page
  return false;
}

function showBannerAndReload() {
  const bar = document.createElement('div');
  bar.textContent = 'Updating to the latest version…';
  bar.style.cssText =
    'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:9999;' +
    'background:#1f1b16;color:#fff;padding:10px 18px;border-radius:999px;font-size:13px;';
  document.body.appendChild(bar);
  setTimeout(() => window.location.reload(), 2500);
}

export async function checkForUpdate(deps = {}) {
  const getLatest = deps.fetchLatest || fetchLatest;
  const busy = deps.isBusy || isBusy;
  const reload = deps.reload || showBannerAndReload;
  const current = deps.current || APP_VERSION;
  const store = deps.store || window.sessionStorage;
  try {
    const latest = await getLatest();
    if (!latest || latest === current) return 'current';
    if (busy()) return 'busy';                                      // try again at the next check
    if (store.getItem('bm_reloaded_for') === latest) return 'already-reloaded';   // never loop
    store.setItem('bm_reloaded_for', latest);
    reload(latest);
    return 'reloading';
  } catch (e) {
    return 'error';                                                 // offline etc.: stay quiet
  }
}

setInterval(() => checkForUpdate(), CHECK_EVERY_MS);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) checkForUpdate();
});

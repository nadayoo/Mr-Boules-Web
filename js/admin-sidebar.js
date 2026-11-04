// Admin-only side menu.
// A "three dashes" button at the top-left opens a panel that slides in from the left: "Welcome Nada" (the first name
// from the admin's login email) and the admin tools, each with a one-line summary. The tools are the buttons that used to
// sit in the tools bar: this panel reads them from there (so a new button shows up here by itself) and the old bar is hidden.
// Students never get it: nothing is added to the page unless the logged-in user is an admin.
import { state } from './auth.js';

// One short line per tool, matched on its label. A tool that is not listed here is shown without a line.
const DESCRIPTIONS = [
  [/missed/i, 'Students who missed 2 or more lessons in a row (homework or attendance), with WhatsApp buttons.'],
  [/blank/i, 'Homework PDFs that are empty, just the question sheet, or the same as another student’s file.'],
  [/fix\s*groups?/i, 'Move a student’s homework to a different group.'],
  [/import/i, 'Add students to the portal from a list.'],
];
// Links to other places, shown under the tools. They open in a new tab.
// NOTE: this file can be read by anyone who opens the site (students included), so these addresses are not secret. Keep each
// Google Sheet shared as "Restricted" (only people you added), never "Anyone with the link".
const LINKS = [
  { label: 'Attendance Sheet', icon: 'ti ti-table', desc: 'Opens the attendance Google Sheet.',
    url: 'https://docs.google.com/spreadsheets/d/1B_HqYmzBzL9LR0WQ_zp30gFcrZvDH3ED5bP6b-jFmT8/edit?gid=357007682#gid=357007682' },
  { label: 'Students Sheet', icon: 'ti ti-users', desc: 'Opens the students Google Sheet.',
    url: 'https://docs.google.com/spreadsheets/d/1Q6Wm47K9buwjh56WVTk8mGEkNqpCkC_WrXe5my1Sr_s/edit?gid=1495965599#gid=1495965599' },
  { label: 'Zoom Attendance Taker', icon: 'ti ti-video', desc: 'Opens the Zoom attendance tool.',
    url: 'https://attendanceextractpic.streamlit.app/' },
  { label: 'OL Tracking Sheet', icon: 'ti ti-chart-dots', desc: 'Opens the tracker sheet that homework and attendance are written into.',
    url: 'https://docs.google.com/spreadsheets/d/1-rCb-H83_NVvaBLKpI2z59xH49Jhn_5DNuCTHLUaAWc/edit?gid=0#gid=0' },
];
const describe = (label) => { const hit = DESCRIPTIONS.find(([re]) => re.test(label)); return hit ? hit[1] : ''; };

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// "nada@admin.com" -> "Nada"
export function adminFirstName(email) {
  const local = String(email || '').split('@')[0];
  const first = local.split(/[._\-+\d]+/).find(Boolean) || 'Admin';
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

const CSS = `
#page.admin-mode #admin-tools { display: none !important; }
#adm-burger { position: fixed; top: 14px; left: 14px; z-index: 900; width: 42px; height: 42px; border-radius: 12px; border: 1px solid #d9d2c5;
  background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,.08); display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; }
#adm-burger span, #adm-burger span::before, #adm-burger span::after { display: block; width: 18px; height: 2px; background: #1f1b16; border-radius: 2px; position: relative; content: ''; }
#adm-burger span::before { position: absolute; top: -6px; }
#adm-burger span::after { position: absolute; top: 6px; }
#adm-backdrop { position: fixed; inset: 0; background: rgba(20,16,10,.35); opacity: 0; pointer-events: none; transition: opacity .2s; z-index: 950; }
#adm-backdrop.open { opacity: 1; pointer-events: auto; }
#adm-drawer { position: fixed; top: 0; left: 0; bottom: 0; width: min(88vw, 340px); background: #fbf9f4; z-index: 960; transform: translateX(-104%);
  transition: transform .25s ease; box-shadow: 4px 0 24px rgba(0,0,0,.18); display: flex; flex-direction: column; font-family: 'Inter', system-ui, sans-serif; }
#adm-drawer.open { transform: translateX(0); }
#adm-drawer .adm-head { display: flex; align-items: center; justify-content: space-between; padding: 22px 20px 14px; border-bottom: 1px solid #e5e0d6; }
#adm-drawer .adm-hello { font-family: 'Source Serif 4', 'Source Serif Pro', Georgia, serif; font-size: 22px; font-weight: 600; color: #1f1b16; }
#adm-drawer .adm-x { border: 0; background: transparent; font-size: 26px; line-height: 1; cursor: pointer; color: #6b6458; padding: 0 4px; }
#adm-drawer .adm-list { padding: 8px 10px; overflow-y: auto; }
#adm-drawer .adm-sec { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #9a9288; padding: 14px 10px 4px; }
#adm-drawer a.adm-item { text-decoration: none; }
#adm-drawer .adm-item { display: flex; gap: 12px; align-items: flex-start; width: 100%; text-align: left; border: 0; background: transparent; cursor: pointer;
  padding: 12px 10px; border-radius: 12px; font-family: inherit; color: #1f1b16; }
#adm-drawer .adm-item:hover { background: #f0ece3; }
#adm-drawer .adm-item i { font-size: 20px; margin-top: 1px; color: #4a7c63; flex: none; }
#adm-drawer .adm-item b { display: block; font-size: 14.5px; font-weight: 600; }
#adm-drawer .adm-item small { display: block; font-size: 12px; color: #7d766a; line-height: 1.4; margin-top: 2px; font-weight: 400; }
`;

let burger = null, backdrop = null, drawer = null, styleEl = null, current = [];

// the tools bar's buttons and links, read fresh every time (other files add their buttons when they load)
function tools() {
  const bar = document.getElementById('admin-tools');
  const out = [];
  if (!bar) return out;
  bar.querySelectorAll('button, a').forEach((el) => {
    const label = String(el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!label) return;
    const i = el.querySelector ? el.querySelector('i') : null;
    out.push({ el, label, icon: (i && i.className) || 'ti ti-chevron-right' });
  });
  return out;
}

export function openAdminMenu() {
  if (!drawer) return;
  current = tools();
  drawer.innerHTML = `
    <div class="adm-head"><div class="adm-hello">Welcome ${esc(adminFirstName(state.userEmail))}</div><button class="adm-x" data-close="1" aria-label="Close menu">×</button></div>
    <div class="adm-list">${current.map((t, n) => {
      const d = describe(t.label);
      return `<button class="adm-item" data-idx="${n}"><i class="${esc(t.icon)}"></i><span><b>${esc(t.label)}</b>${d ? `<small>${esc(d)}</small>` : ''}</span></button>`;
    }).join('')}
      <div class="adm-sec">Links</div>
      ${LINKS.map((l) => `<a class="adm-item" data-link="1" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer"><i class="${esc(l.icon)}"></i><span><b>${esc(l.label)}</b><small>${esc(l.desc)}</small></span></a>`).join('')}
    </div>`;
  drawer.classList.add('open');
  backdrop.classList.add('open');
}

export function closeAdminMenu() {
  if (drawer) drawer.classList.remove('open');
  if (backdrop) backdrop.classList.remove('open');
}

const onKey = (e) => { if (e && e.key === 'Escape') closeAdminMenu(); };

function show() {
  if (burger) return;
  styleEl = document.createElement('style');
  styleEl.id = 'adm-style';
  styleEl.textContent = CSS;
  document.head.appendChild(styleEl);

  burger = document.createElement('button');
  burger.id = 'adm-burger';
  burger.setAttribute('aria-label', 'Open menu');
  burger.innerHTML = '<span></span>';
  burger.addEventListener('click', openAdminMenu);

  backdrop = document.createElement('div');
  backdrop.id = 'adm-backdrop';
  backdrop.addEventListener('click', closeAdminMenu);

  drawer = document.createElement('div');
  drawer.id = 'adm-drawer';
  drawer.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target.closest('[data-idx], [data-close], [data-link]') : null;
    if (!t) return;
    if (t.dataset && (t.dataset.close || t.dataset.link)) { closeAdminMenu(); return; }      // a link opens by itself in a new tab
    const tool = current[Number(t.dataset.idx)];
    closeAdminMenu();
    if (tool) tool.el.click();                // runs the tool's own button, exactly as before
  });

  document.body.appendChild(burger);
  document.body.appendChild(backdrop);
  document.body.appendChild(drawer);
  document.addEventListener('keydown', onKey);
}

function hide() {
  [burger, backdrop, drawer, styleEl].forEach((n) => { if (n && n.remove) n.remove(); });
  burger = backdrop = drawer = styleEl = null;
  current = [];
  document.removeEventListener('keydown', onKey);
}

// Shown only while an admin is logged in (the page gets the "admin-mode" class at login and loses it at logout)
function sync() {
  const page = document.getElementById('page');
  const isAdmin = !!(state && state.isAdmin) && !!page && page.classList.contains('admin-mode');
  if (isAdmin) show(); else hide();
}

const page = document.getElementById('page');
if (page && typeof MutationObserver !== 'undefined') new MutationObserver(sync).observe(page, { attributes: true, attributeFilter: ['class'] });

window.openAdminMenu = openAdminMenu;
window.closeAdminMenu = closeAdminMenu;

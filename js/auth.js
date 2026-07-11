import { db, ADMIN_EMAIL, ADMIN_ID, ALL_SUBJECTS, toast } from './config.js';
import { getDoc, doc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { buildHub, startListeners } from './hub.js';

export let state = {
  isAdmin: false,
  userSubjects: []
};

export function validateID(id) {
  if (!id || id.length !== 5) return false;
  if (!/^[A-Za-z]/.test(id)) return false;
  return id.replace(/[^A-Za-z]/g,'').length === 2 && id.replace(/[^0-9]/g,'').length === 3;
}

export function showError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg; el.style.display = 'block';
}

export async function doLogin() {
  const email = document.getElementById('login-email').value.trim().toLowerCase();
  const id    = document.getElementById('login-id').value.trim().toUpperCase();
  const btn   = document.getElementById('login-btn');
  document.getElementById('login-error').style.display = 'none';

  if (!email) { showError('Enter your email to continue.'); return; }
  if (!id)    { showError('Enter your Student ID to continue.'); return; }

  if (email === ADMIN_EMAIL.toLowerCase() && id === ADMIN_ID) {
    state.isAdmin      = true;
    state.userSubjects = ALL_SUBJECTS;
    enterHub(email);
    return;
  }

  if (!validateID(id)) {
    showError('ID format looks off — 5 characters, 2 letters and 3 numbers, starting with a letter.');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2"></i> Signing in…';

  try {
    const snap = await getDoc(doc(db, 'students', email));
    if (snap.exists() && snap.data().id === id) {
      state.isAdmin = false;
      const raw = snap.data().subjects || ALL_SUBJECTS;
      state.userSubjects = ALL_SUBJECTS.filter(s => raw.includes(s));
      if (state.userSubjects.length === 0) state.userSubjects = ALL_SUBJECTS;
      enterHub(email);
    } else {
      showError("Couldn't match that email and ID. Double-check, or contact the assistants.");
    }
  } catch(e) { showError('Connection error — please try again.'); }

  btn.disabled = false;
  btn.innerHTML = '<i class="ti ti-arrow-right"></i> Sign in';
}

export function enterHub(email) {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('hub-screen').style.display   = 'block';
  document.getElementById('user-email-display').textContent = email;
  const badge = document.getElementById('role-badge');
  if (state.isAdmin) {
    badge.textContent = 'Admin'; badge.className = 'role-badge admin';
    document.getElementById('page').classList.add('admin-mode');
    document.getElementById('admin-tools').style.display = 'flex';
  } else {
    badge.textContent = 'Student'; badge.className = 'role-badge student';
  }
  buildHub(state.userSubjects);
  startListeners();
  toast('Welcome back', 'ti-hand-stop');
}

export function doLogout() {
  state.isAdmin = false; state.userSubjects = [];
  document.getElementById('hub-screen').style.display   = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-email').value = '';
  document.getElementById('login-id').value    = '';
  document.getElementById('page').classList.remove('admin-mode');
  document.getElementById('admin-tools').style.display = 'none';
  document.getElementById('subject-tabs').innerHTML   = '';
  document.getElementById('subject-panels').innerHTML = '';
}

window.doLogin = doLogin;
window.doLogout = doLogout;

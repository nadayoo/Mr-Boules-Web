import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

export const firebaseConfig = {
  apiKey: "AIzaSyBGSbYUWWZQ_4zt_0JIJ-bc4tPZVfbhmt8",
  authDomain: "mr-boules.firebaseapp.com",
  projectId: "mr-boules",
  storageBucket: "mr-boules.firebasestorage.app",
  messagingSenderId: "263455567927",
  appId: "1:263455567927:web:8fc3167510b775cad88fb2"
};

export const app = initializeApp(firebaseConfig);
export const db  = getFirestore(app);
export const storage = getStorage(app);

export const ADMIN_EMAIL = "nada@admin.com";
export const ADMIN_ID    = "ADMIN";

export const ALL_SUBJECTS = ['aspure','a2pure','mechanics','statistics','olcam','oledx'];
export const SUBJECT_META = {
  aspure:     { label: 'AS Pure',    icon: 'ti-math-function'  },
  a2pure:     { label: 'A2 Pure',    icon: 'ti-math-function'  },
  mechanics:  { label: 'Mechanics',  icon: 'ti-rocket'         },
  statistics: { label: 'Statistics', icon: 'ti-chart-histogram' },
  olcam:      { label: 'OL Cambridge',  icon: 'ti-math' },
  oledx:      { label: 'OL Edexcel',    icon: 'ti-math' }
};
export const DAY_ORDER = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
export const SECTIONS  = ['announcements','recordings','homework','notes','schedule'];
export const SECTION_META = {
  announcements: { label: 'Announcements',            icon: 'ti-speakerphone', addLabel: 'New announcement' },
  recordings:    { label: 'Recordings',               icon: 'ti-video',        addLabel: 'Add recording'    },
  homework:      { label: 'Homework & Assignments',    icon: 'ti-notebook',     addLabel: 'Add homework'     },
  notes:         { label: 'Lecture Notes & Resources', icon: 'ti-file-text',    addLabel: 'Add notes'        },
  schedule:      { label: 'Weekly Schedule',           icon: 'ti-calendar',     addLabel: 'Add schedule entry'}
};

export function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function toast(msg, icon = 'ti-check') {
  const el = document.getElementById('toast');
  el.innerHTML = `<i class="ti ${icon}"></i> ${esc(msg)}`;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}

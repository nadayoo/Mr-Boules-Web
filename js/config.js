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

export const ADMINS = {
  "nada@admin.com": "ADMIN",
  "farah@admin.com": "ADMIN0",
  "batoul@admin.com": "ADMIN1",
  "farida@admin.com": "ADMIN2",
  "jaidaa@admin.com": "ADMIN3",
  "judy@admin.com": "ADMIN4",
  "lobna@admin.com": "ADMIN5",
  "menna@admin.com": "ADMIN6",
  "parthinia@admin.com": "ADMIN7",
  "judi@admin.com": "ADMIN8",
  "mrboules@admin.com": "ADMIN0909"
};

export const ALL_SUBJECTS = ['aspure','a2pure','mechanics','statistics','olcam','oledx'];
export const ACTIVE_SUBJECTS = ['olcam','oledx'];
export const SUBJECT_META = {
  aspure:     { label: 'AS Pure',    icon: 'ti-math-function'  },
  a2pure:     { label: 'A2 Pure',    icon: 'ti-math-function'  },
  mechanics:  { label: 'Mechanics',  icon: 'ti-rocket'         },
  statistics: { label: 'Statistics', icon: 'ti-chart-histogram' },
  olcam:      { label: 'OL Cambridge',  icon: 'ti-math' },
  oledx:      { label: 'OL Edexcel',    icon: 'ti-math' }
};
export const DAY_ORDER = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
export const SECTIONS  = ['announcements','homework','notes','schedule','marks'];
export const SECTION_META = {
  announcements: { label: 'Announcements',            icon: 'ti-speakerphone', addLabel: 'New announcement' },
  homework:      { label: 'Homework & Assignments',    icon: 'ti-notebook',     addLabel: 'Add homework'     },
  notes:         { label: 'Lecture Notes & Resources', icon: 'ti-file-text',    addLabel: 'Add notes'        },
  schedule:      { label: 'Weekly Schedule',           icon: 'ti-calendar',     addLabel: 'Add schedule entry'},
  marks:         { label: 'Quiz & Exam Marks',         icon: 'ti-chart-bar',    addLabel: 'Manage marks'     }
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
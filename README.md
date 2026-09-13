# Mr. Boules — Student Portal & Attendance System

An all-in-one educational management portal built with HTML5, CSS3, JavaScript (ES6 Modules), and Firebase. Designed for tracking student submissions, publishing lecture notes, scheduling weekly classes, posting quiz/exam marks, and managing session attendance across multiple curricula (Cambridge & Edexcel).

---

## 🌟 Key Features

* **Authentication & Role Access:**  
  * **Students:** Secure login using Email + 5-character Student ID validation (e.g., `AB123`).
  * **Admins:** Dedicated admin authorization with administrative controls and content creation privileges.

* **Attendance Management:**  
  * CSV upload pipeline mapping student IDs directly to registered emails.
  * Real-time student attendance status tracking and automated reporting of unlinked IDs.

* **Homework & Submissions:**  
  * Admin assignment creation with deadline enforcement, PDF downloads, and image previews.
  * Single-submission rule per student with Firebase Storage integration.
  * Consecutive missed homework alerts for students.

* **Quiz & Exam Marks:**  
  * Batch CSV mark uploading with automated ZIP file mapping to link student PDFs to individual grades.

* **Interactive Hub:**  
  * Tabbed curriculum views (`OL Cambridge`, `OL Edexcel`, `AS Pure`, etc.).
  * Real-time UI updates powered by Firestore `onSnapshot` listeners.

---

## 🛠️ Tech Stack

* **Frontend:** Vanilla JS (ES Modules), CSS3 (Custom Variables), HTML5
* **Icons:** Tabler Icons (`@tabler/icons-webfont`)
* **Backend & Database:** Firebase Firestore (v10.12)
* **Storage:** Firebase Storage
* **Libraries:** JSZip (PDF/ZIP extraction for marks)

---

## 📂 Project Structure

```text
├── index.html         # Application shell and entry DOM structure
├── css/               # Global styles and theme definitions
└── js/
    ├── config.js      # Firebase initialisation, Admin maps, & Subject metadata
    ├── auth.js        # Auth state management & ID validation
    ├── hub.js         # Core workspace tab builders & Firestore real-time listeners
    ├── render.js      # UI Render pipeline for all sections (Homework, Attendance, etc.)
    ├── modal.js       # Dynamic modal dialog handler & submission workflows
    ├── attendance.js # CSV parsing & Firestore attendance batch upload logic
    └── marks.js      # CSV/ZIP extraction and batch grade entry logic
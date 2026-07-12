# Mr. Boules — Math Class Hub

A web app for Mr. Boules' mathematics students (Oct/Nov 2026 session). Students log in with their email and student ID to access subject-specific content. Admin can post announcements, recordings, homework, notes, schedules, and marks.

---

## File Structure

```
Mr-Boules-Web/
├── index.html              ← Main entry point (login + hub shell)
├── import-students.html    ← Admin-only tool to bulk import students
├── firebase.json           ← Firebase hosting config
├── README.md               ← This file
├── css/
│   └── main.css            ← All styles
└── js/
    ├── config.js           ← Firebase init, shared constants, helpers (esc, toast)
    ├── auth.js             ← Login, logout, session state
    ├── hub.js              ← Builds subject tabs/panels, Firestore listeners, tab switching
    ├── render.js           ← One render function per section (announcements, homework, etc.)
    ├── modal.js            ← Add modal (openAdd, submitAdd, file upload)
    └── marks.js            ← CSV marks upload logic
```

---

## Import Order (in index.html)

The JS files depend on each other. Load them in this exact order:

```html
<script type="module" src="js/config.js"></script>
<script type="module" src="js/auth.js"></script>
<script type="module" src="js/render.js"></script>
<script type="module" src="js/marks.js"></script>
<script type="module" src="js/modal.js"></script>
<script type="module" src="js/hub.js"></script>
```

> **Note:** Each file imports from the others using named exports. The filenames in the import statements inside each JS file must match exactly — currently they reference `config.v5.js`, `auth.v5.js`, etc. Either rename the files to match, or update the import paths inside each file to match whatever you name them.

---

## Subjects

| Key | Label | Who takes it |
|---|---|---|
| `aspure` | AS Pure | AS level students |
| `a2pure` | A2 Pure | A2 level students |
| `mechanics` | Mechanics | AS/A2 |
| `statistics` | Statistics | AS/A2 |
| `olcam` | OL Cambridge | O Level Cambridge |
| `oledx` | OL Edexcel | O Level Edexcel |

Each student's enrolled subjects are stored in Firestore and set via `import-students.html`.

---

## Sections (per subject)

| Section | What it holds |
|---|---|
| Announcements | Pinned notices, badges (new / important) |
| Recordings | Lecture links (YouTube, Zoom, Drive) or uploaded PDFs |
| Homework | Assignments with due dates, images, done/not-done checkbox |
| Notes | Lecture notes with PDF upload or Drive links |
| Schedule | Weekly timetable with day, time, group, lesson number |
| Marks | Quiz/exam results uploaded via CSV (students see only their own) |

---

## Admin Credentials

Set inside `js/config.js`:

```js
export const ADMIN_EMAIL = "nada@admin.com";
export const ADMIN_ID    = "ADMIN";
```

Change these before deploying if needed.

---

## Firebase Setup

- **Firestore** — stores all content and student records
- **Firebase Storage** — stores uploaded images (homework) and PDFs (recordings, notes)
- **Project ID:** `mr-boules`
- **Firestore rules:** must allow `read, write: if true` for the import tool and admin panel to work (tighten later with Firebase Auth)

---

## Importing Students

1. Open `import-students.html` in your browser (do **not** deploy this file — keep it local)
2. Paste student list in the format:
```
email,ID,subject,subject,...
ahmed@gmail.com,A0A56,aspure,mechanics
sara@gmail.com,A6B32,aspure,statistics
omar@gmail.com,A1C45,aspure,mechanics,a2pure,statistics
```
3. Click **Import Students**
4. Green ticks = success

**Valid subjects:** `aspure` · `a2pure` · `mechanics` · `statistics` · `olcam` · `oledx`

**ID format:** 5 characters, starts with a letter, exactly 2 letters and 3 numbers (e.g. `A0A56`, `T14Z5`)

---

## Uploading Marks

1. Log in as admin
2. Go to any subject → **Marks** tab → click **Manage**
3. Enter a quiz title
4. Upload a CSV file with two columns:

```
email,mark
ahmed@gmail.com,85
sara@gmail.com,91
```

Students only see their own mark. Admin sees everyone's.

---

## Deploying (Firebase Hosting)

```bash
firebase login
firebase init hosting   # public dir = "." , rewrite all to index.html
firebase deploy
```

Or drag the folder into [Netlify Drop](https://app.netlify.com/drop) for instant hosting.

---

# Mr. Boules Web Portal (`Mr-Boules-Web`)

An interactive student management web application and automated administrative dashboard built to process attendance, assignment marks, and cohort records for Cambridge and Edexcel students.

---

## Technical Architecture Overview

The application follows a decoupled client-serverless architecture utilizing vanilla JavaScript modules on the frontend and Node.js Firebase Cloud Functions on the backend.

### Frontend Logic (`/js`)
- **`auth.js`**: Handles Firebase Authentication state, login flows, and session persistence.
- **`config.js`**: Holds Firebase client SDK setup and configuration parameters.
- **`attendance.js`**: Manages frontend attendance recording, status toggles, and UI interactions.
- **`marks.js`**: Logic for homework submission tracking and student mark calculations.
- **`hub.js`**: Main dashboard controller orchestrating module views and student navigation.
- **`modal.js`**: UI component logic for popup dialogs and confirmation screens.
- **`render.js`**: Dynamic DOM rendering pipeline for data lists, tables, and views.

### Backend & Serverless (`/functions`)
- **`index.js`**: Entry point for Cloud Functions, database triggers (e.g., Firestore listeners), and API endpoints.
- **`attendanceSheet.js`**: Automated ingestion and sync service for external spreadsheet data and attendance parsing.
- **`service-account.json`**: *(Local only)* Firebase Admin SDK credentials for local emulator testing.

---

## Project Directory Tree

```text
Boules/
├── .agents/               # Agent configuration/prompt files
├── .firebase/             # Firebase local deployment build cache
├── css/                   # Stylesheets
├── functions/             # Firebase Serverless Backend (Node.js)
│   ├── node_modules/
│   ├── attendanceSheet.js # Attendance sync service & sheet parser
│   ├── index.js           # Cloud Functions entry point
│   ├── package-lock.json
│   ├── package.json
│   └── service-account.json # Private local key (git-ignored)
├── js/                    # Client-Side Application Modules
│   ├── attendance.js      # Attendance features logic
│   ├── auth.js            # Authentication logic
│   ├── config.js          # Firebase SDK configuration
│   ├── hub.js             # Dashboard controller
│   ├── marks.js           # Student marks & homework logic
│   ├── modal.js           # UI Modal dialog handler
│   └── render.js          # DOM manipulation & view rendering
├── .firebaserc            # Firebase project target aliases
├── .gitignore             # Git exclusion rules
├── firebase.json          # Firebase Hosting & Functions configuration
├── import-students.html   # Bulk student import batch page
├── index.html             # Application entry point & main layout
├── README.md              # Project documentation
└── skills-lock.json       # Agent/Tool skills environment file

## Setup & Deployment

### Prerequisites

* Node.js (v18+)
* Firebase CLI (`npm install -g firebase-tools`)

---

### Local Environment Setup

* **Clone & Install Dependencies:**
  ```bash
  git clone [https://github.com/nadayoo/Mr-Boules-Web.git](https://github.com/nadayoo/Mr-Boules-Web.git)
  cd Boules/functions
  npm install
  cd ..

### Configure Service Account Key

Place your generated Firebase Admin JSON key inside `functions/service-account.json`.

> **Security Warning:** `service-account.json` is blocked by `.gitignore`. Never commit this file.

---

### Run via Firebase Emulators

```bash
firebase emulators:start


### Deployment Commands
# Deploy entire stack (Hosting + Functions)
firebase deploy

# Deploy Cloud Functions only
firebase deploy --only functions

# Deploy Frontend static hosting only
firebase deploy --only hosting
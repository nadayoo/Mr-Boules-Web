const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { google } = require("googleapis");

admin.initializeApp();

const SHEET_ID = "1-rCb-H83_NVvaBLKpI2z59xH49Jhn_5DNuCTHLUaAWc";

const SUBJECT_TO_TAB = {
  olcam: "OL Cambridge",
  oledx: "OL Edexcel",
};

// Helper: Convert Column Number to Letter (e.g. 1 -> A, 27 -> AA)
function columnToLetter(col) {
  let letter = "";
  while (col > 0) {
    const temp = (col - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    col = Math.floor((col - temp - 1) / 26);
  }
  return letter;
}

// Shared logic for processing attendance records into Google Sheets
async function handleAttendanceSync(snap, subject) {
  const serviceAccount = require("./service-account.json");

  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const data = snap.data();
  if (!data) return null;

  const tabName = SUBJECT_TO_TAB[subject];
  if (!tabName) {
    console.log("Subject not tracked for attendance:", subject);
    return null;
  }

  // 1. Extract and clean the session title header
  // Takes raw title like "Lesson 1, Group 1: Alegebra" or "Lesson 1: Algebra"
  let rawTitle = data.title || data.sessionTitle || data.date || "Attendance";
  let attHeader = rawTitle.trim();

  // Strip ", Group ..." or " Group ..." up to a colon or end of string
  if (attHeader.includes(",")) {
    attHeader = attHeader.split(",")[0].trim();
  } else if (attHeader.includes(":")) {
    attHeader = attHeader.split(":")[0].trim();
  }

  const presentEmails = (data.presentEmails || []).map((e) =>
    e.toString().trim().toLowerCase()
  );

  const sheets = google.sheets({ version: "v4", auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${tabName}!A1:ZZ`,
  });

  let rows = response.data.values || [];
  if (rows.length === 0) {
    rows = [["Name", "Email", "", "Student ID"]];
  }

  const header = rows[0];

  // 2. Locate or create lesson column (e.g., "Lesson 1")
  let attColIndex = header.indexOf(attHeader);
  if (attColIndex === -1) {
    header.push(attHeader);
    attColIndex = header.length - 1;

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${tabName}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [header] },
    });
  }

  const colLetter = columnToLetter(attColIndex + 1);

  // 3. Mark "Attended" for matching students
  for (let i = 1; i < rows.length; i++) {
    const cellEmail = rows[i] && rows[i][1] ? rows[i][1].toString().trim().toLowerCase() : "";
    if (cellEmail && presentEmails.includes(cellEmail)) {
      const rowNumber = i + 1;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${tabName}!${colLetter}${rowNumber}`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [["Attended"]],
        },
      });
    }
  }

  return null;
}

// ------------------------------------------------------------------
// SUBMISSION TRIGGER
// ------------------------------------------------------------------
exports.onSubmissionCreated = functions.firestore
  .document("submissions/{docId}")
  .onCreate(async (snap, context) => {
    const serviceAccount = require("./service-account.json");

    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccount,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const data = snap.data();
    const email = data.email || data.studentEmail || data.userEmail || "";
    const { studentId, subject, homeworkId, homeworkTitle, hwCode } = data;

    const tabName = SUBJECT_TO_TAB[subject];
    if (!tabName) {
      console.log("Subject not tracked:", subject);
      return null;
    }

    let hwHeader = hwCode || homeworkTitle || "";

    if (!hwHeader && homeworkId && subject) {
      try {
        const hwDoc = await admin
          .firestore()
          .collection(`${subject}_homework`)
          .doc(homeworkId)
          .get();

        if (hwDoc.exists) {
          const hwData = hwDoc.data();
          hwHeader = hwData.hwCode || hwData.title || hwData.name || homeworkId;
        }
      } catch (err) {
        console.error("Error fetching homework doc:", err);
      }
    }

    hwHeader = hwHeader || homeworkId || "Unknown";

    const sheets = google.sheets({ version: "v4", auth });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${tabName}!A1:ZZ`,
    });

    let rows = response.data.values || [];
    if (rows.length === 0) {
      rows = [["Name", "Email", "", "Student ID"]];
    }

    const header = rows[0];

    let hwColIndex = header.indexOf(hwHeader);
    if (hwColIndex === -1) {
      header.push(hwHeader);
      hwColIndex = header.length - 1;

      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${tabName}!A1`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [header] },
      });
    }

    const targetEmail = email.toString().trim().toLowerCase();
    let studentRowIndex = -1;

    if (targetEmail) {
      for (let i = 1; i < rows.length; i++) {
        const cellEmail =
          rows[i] && rows[i][1]
            ? rows[i][1].toString().trim().toLowerCase()
            : "";
        if (cellEmail === targetEmail) {
          studentRowIndex = i;
          break;
        }
      }
    }

    if (studentRowIndex === -1) {
      const rowLen = Math.max(header.length, 4);
      const newRow = new Array(rowLen).fill("");
      newRow[1] = email || "";
      newRow[3] = studentId || "";
      newRow[hwColIndex] = "Submitted";

      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `${tabName}!A:A`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [newRow] },
      });
    } else {
      const rowNumber = studentRowIndex + 1;
      const colLetter = columnToLetter(hwColIndex + 1);

      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${tabName}!${colLetter}${rowNumber}`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [["Submitted"]],
        },
      });
    }

    return null;
  });

// ------------------------------------------------------------------
// ATTENDANCE TRIGGERS
// ------------------------------------------------------------------
exports.onOlcamAttendanceCreated = functions.firestore
  .document("olcam_attendance/{docId}")
  .onCreate(async (snap) => {
    return handleAttendanceSync(snap, "olcam");
  });

exports.onOledxAttendanceCreated = functions.firestore
  .document("oledx_attendance/{docId}")
  .onCreate(async (snap) => {
    return handleAttendanceSync(snap, "oledx");
  });
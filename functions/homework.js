const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { google } = require("googleapis");

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

// Title -> sheet column header, based on the lesson number only.
// "Lesson 1, Group 5: Homework 1" -> "hw01"
// "Lecture 1, Group x"            -> "hw01"
// "Lesson 12: Algebra"            -> "hw12"
function lessonToHwHeader(title) {
  const m = (title || "").toString().match(/(?:Lesson|Lecture|Session)\s*(\d+)/i);
  if (!m) return "";
  return "hw" + String(parseInt(m[1], 10)).padStart(2, "0");
}

exports.lessonToHwHeader = lessonToHwHeader;

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

    // Column is decided by the lesson number in the title, so every
    // homework from "Lesson 1" goes to the same column (hw01).
    let hwHeader = lessonToHwHeader(homeworkTitle);

    if (!hwHeader && homeworkId && subject) {
      try {
        const hwDoc = await admin
          .firestore()
          .collection(`${subject}_homework`)
          .doc(homeworkId)
          .get();

        if (hwDoc.exists) {
          const hwData = hwDoc.data();
          hwHeader = lessonToHwHeader(hwData.title || hwData.name);
        }
      } catch (err) {
        console.error("Error fetching homework doc:", err);
      }
    }

    // Fallbacks if no lesson number could be found anywhere
    hwHeader = hwHeader || (hwCode || "").toString().trim() || homeworkTitle || homeworkId || "Unknown";

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

    let hwColIndex = header.findIndex(
      (h) => (h || "").toString().trim().toLowerCase() === hwHeader.toLowerCase()
    );
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
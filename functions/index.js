const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { google } = require("googleapis");

admin.initializeApp();

const SHEET_ID = "1-rCb-H83_NVvaBLKpI2z59xH49Jhn_5DNuCTHLUaAWc";

const SUBJECT_TO_TAB = {
  olcam: "OL Cambridge",
  oledx: "OL Edexcel",
};

exports.onSubmissionCreated = functions.firestore
  .document("submissions/{docId}")
  .onCreate(async (snap, context) => {
    // Load credentials only when function runs (not during deploy)
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

    // Prefer hw01 / hw02, then title, then ID
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

function columnToLetter(col) {
  let letter = "";
  while (col > 0) {
    const temp = (col - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    col = Math.floor((col - temp - 1) / 26);
  }
  return letter;
}
const admin = require("firebase-admin");
const { google } = require("googleapis");

const SHEET_ID = "1-rCb-H83_NVvaBLKpI2z59xH49Jhn_5DNuCTHLUaAWc";

const SUBJECT_TO_ATTENDANCE_TAB = {
  olcam: "Cambridge Attendance",
  oledx: "Edexcel Attendance",
};

function columnToLetter(col) {
  let letter = "";
  while (col > 0) {
    const temp = (col - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    col = Math.floor((col - temp - 1) / 26);
  }
  return letter;
}

async function handleAttendanceCreated(snap, context) {
  const { subject } = context.params;
  const tabName = SUBJECT_TO_ATTENDANCE_TAB[subject];

  if (!tabName) {
    console.log("Subject attendance not tracked:", subject);
    return null;
  }

  const data = snap.data();
  const rawTitle = data.title || "Lesson";
  const presentEmails = data.presentEmails || [];

  if (!presentEmails.length) {
    console.log("No present emails in attendance doc.");
    return null;
  }

  // Extract "Lesson X" or "Session X" from title (e.g. "Lesson 1, Group 1: Algebra" -> "Lesson 1")
  const match = rawTitle.match(/(Lesson\s*\d+|Session\s*\d+)/i);
  const lessonHeader = match ? match[0].trim() : rawTitle.trim();

  const serviceAccount = require("./service-account.json");
  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });

  // Read full sheet data
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${tabName}!A1:ZZ`,
  });

  let rows = response.data.values || [];
  if (rows.length === 0) {
    rows = [["Name", "Email", "", "Student ID"]];
  }

  const header = rows[0];

  // Check if column exists, create it if missing
  let colIndex = header.indexOf(lessonHeader);
  if (colIndex === -1) {
    header.push(lessonHeader);
    colIndex = header.length - 1;

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${tabName}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [header] },
    });
  }

  const colLetter = columnToLetter(colIndex + 1);
  const updates = [];
  const newRowsToAppend = [];

  // Process all matched emails in batch
  for (const emailRaw of presentEmails) {
    const targetEmail = emailRaw.toString().trim().toLowerCase();
    if (!targetEmail) continue;

    let studentRowIndex = -1;
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

    if (studentRowIndex !== -1) {
      const rowNumber = studentRowIndex + 1;
      updates.push({
        range: `${tabName}!${colLetter}${rowNumber}`,
        values: [["Attended"]],
      });
    } else {
      const rowLen = Math.max(header.length, 4);
      const newRow = new Array(rowLen).fill("");
      newRow[1] = targetEmail;
      newRow[colIndex] = "Attended";
      newRowsToAppend.push(newRow);
    }
  }

  // Execute updates in batch
  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data: updates,
      },
    });
  }

  // Append any unlisted students
  if (newRowsToAppend.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${tabName}!A:A`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: newRowsToAppend },
    });
  }

  return null;
}

module.exports = { handleAttendanceCreated };
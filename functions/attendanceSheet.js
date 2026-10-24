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

// Safety net: before adding a student who is not in this tab yet, check their subject.
// Returns Map(email -> { id, subjects:Set }) for the emails found in the "students" collection.
async function lookupStudents(emails) {
  const found = new Map();
  const db = admin.firestore();
  for (let i = 0; i < emails.length; i += 25) {
    const chunk = emails.slice(i, i + 25);
    const snaps = await Promise.all(chunk.map((e) => db.collection("students").doc(e).get()));
    snaps.forEach((s, k) => {
      if (!s.exists) return;
      const d = s.data() || {};
      const subjects = new Set((Array.isArray(d.subjects) ? d.subjects : []).map((x) => String(x).toLowerCase()));
      found.set(chunk[k], { id: String(d.id || "").trim(), subjects });
    });
  }
  return found;
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
    rows = [["Name", "Email", "Student ID"]];
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
  const missing = [];

  // Students already in the tab get their cell marked; the rest are collected
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
    } else if (!missing.includes(targetEmail)) {
      missing.push(targetEmail);
    }
  }

  // Not in the tab yet: only add them if they really belong to this subject
  const newRowsToAppend = [];
  const skipped = [];
  if (missing.length) {
    const students = await lookupStudents(missing);
    for (const email of missing) {
      const st = students.get(email);
      if (st && st.subjects.size > 0 && !st.subjects.has(subject)) {
        skipped.push(email);                                   // e.g. an Edexcel student in the Cambridge upload
        continue;
      }
      const rowLen = Math.max(header.length, 4);
      const newRow = new Array(rowLen).fill("");
      newRow[1] = email;
      newRow[2] = st && st.id ? st.id : "";                    // column C = Student ID
      newRow[colIndex] = "Attended";
      newRowsToAppend.push(newRow);
    }
  }
  if (skipped.length) {
    console.log(`Not added to "${tabName}" (not in ${subject}): ${skipped.join(", ")}`);
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

  // Append any unlisted students who belong here
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

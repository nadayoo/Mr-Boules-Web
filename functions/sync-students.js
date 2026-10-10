#!/usr/bin/env node
/**
 * Copies students from the Firestore "students" collection into the Google Sheet:
 *   column B = email, column C = student ID
 *
 * Run one subject at a time, so the sheets never mix:
 *   --subject olcam   ->  "OL Cambridge"  +  "Cambridge Attendance"   (Cambridge students only)
 *   --subject oledx   ->  "OL Edexcel"    +  "Edexcel Attendance"     (Edexcel students only)
 *   --tab "Name"      ->  one specific tab, all students
 *
 * - Adds students whose email is not in column B yet (appended at the bottom)
 * - Fills column C for existing rows where it is empty (never overwrites a filled cell)
 * - Never deletes or changes anything else
 *
 * From the project root (dry run: writes nothing):
 *   node functions/sync-students.js --subject olcam
 *   node functions/sync-students.js --subject oledx
 * Add --write to actually write:
 *   node functions/sync-students.js --subject olcam --write
 *   node functions/sync-students.js --subject oledx --write
 *
 * If it can't tell which subject a student has, tell it which field to read:
 *   node functions/sync-students.js --subject olcam --field subjects
 */
const admin = require("firebase-admin");
const { google } = require("googleapis");

const SHEET_ID = "1-rCb-H83_NVvaBLKpI2z59xH49Jhn_5DNuCTHLUaAWc";

// Each subject has a homework tab and an attendance tab. Both get the same email + ID.
const SUBJECT_TABS = {
  olcam: ["OL Cambridge", "Cambridge Attendance"],
  oledx: ["OL Edexcel", "Edexcel Attendance"],
};

// Student document fields that may hold the subject
const SUBJECT_FIELDS = ["subjects", "subject", "userSubjects", "courses", "course"];

function getArg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return null;
  const next = process.argv[i + 1];
  return next && !next.startsWith("--") ? next : true;
}

// Which subject(s) a student has. Understands "olcam", "Cambridge", "oledx", "Edexcel".
function subjectsOf(data, onlyField) {
  const out = new Set();
  const values = [];
  const fields = onlyField ? [onlyField] : SUBJECT_FIELDS;
  for (const f of fields) {
    const v = data && data[f];
    if (Array.isArray(v)) values.push(...v);
    else if (v) values.push(v);
  }
  for (const v of values) {
    const s = String(v).toLowerCase();
    if (/cam/.test(s)) out.add("olcam");
    if (/edx|edex/.test(s)) out.add("oledx");
  }
  return out;
}

async function main() {
  const subject = getArg("subject");
  const tabArg = getArg("tab");
  const field = getArg("field");
  const write = process.argv.includes("--write");

  let tabs;
  if (subject && subject !== true) {
    if (!SUBJECT_TABS[subject]) {
      console.error(`Unknown subject "${subject}". Use one of: ${Object.keys(SUBJECT_TABS).join(", ")}`);
      process.exit(1);
    }
    tabs = SUBJECT_TABS[subject];
  } else if (tabArg && tabArg !== true) {
    tabs = [tabArg];
  } else {
    console.error('Please pass --subject olcam|oledx   (or --tab "<tab name>")');
    process.exit(1);
  }
  const onlyField = field && field !== true ? field : null;

  const serviceAccount = require("./service-account.json");
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  // 1. Read students from Firestore: email -> id (only this subject's students)
  const snap = await admin.firestore().collection("students").get();
  const students = new Map();
  let noEmail = 0, otherSubject = 0, noSubject = 0;
  const unknownExamples = [];
  let sampleFields = null;
  snap.forEach((d) => {
    const x = d.data();
    if (!sampleFields) sampleFields = Object.keys(x);
    const email = String(x.email || "").trim().toLowerCase();
    if (!email) { noEmail++; return; }
    if (subject && subject !== true) {
      const subs = subjectsOf(x, onlyField);
      if (!subs.size) {
        noSubject++;
        if (unknownExamples.length < 3) unknownExamples.push(email);
        return;
      }
      if (!subs.has(subject)) { otherSubject++; return; }
    }
    const id = String(x.id ?? "").trim();
    if (!students.has(email) || (!students.get(email) && id)) students.set(email, id);
  });

  console.log(`Students in Firestore: ${snap.size}`);
  console.log(`Selected for ${subject && subject !== true ? `"${subject}"` : "all tabs"}: ${students.size}`);
  if (noEmail) console.log(`  skipped, no email: ${noEmail}`);
  if (otherSubject) console.log(`  skipped, other subject: ${otherSubject}`);
  if (noSubject) {
    console.log(`  skipped, no recognisable subject: ${noSubject}  (e.g. ${unknownExamples.join(", ")})`);
    console.log(`  fields on a student document: ${(sampleFields || []).join(", ")}`);
    console.log(`  -> if the subject is in one of those fields, add:  --field <fieldname>`);
  }

  // 2. Each tab
  for (const tab of tabs) {
    const q = `'${String(tab).replace(/'/g, "''")}'`;   // safe A1 tab name
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${q}!A1:ZZ`,
    });
    const rows = res.data.values || [];
    const rowOfEmail = new Map();
    for (let i = 1; i < rows.length; i++) {
      const e = String((rows[i] && rows[i][1]) || "").trim().toLowerCase();
      if (e && !rowOfEmail.has(e)) rowOfEmail.set(e, i);
    }

    const toAdd = [];
    const toFill = [];
    for (const [email, id] of students) {
      if (!rowOfEmail.has(email)) {
        toAdd.push([email, id]);
      } else {
        const i = rowOfEmail.get(email);
        const current = String((rows[i] && rows[i][2]) || "").trim();
        if (!current && id) toFill.push({ row: i + 1, email, id });
      }
    }

    console.log(`\n=== "${tab}" ===  already there: ${rowOfEmail.size} | to add: ${toAdd.length} | IDs to fill: ${toFill.length}`);
    toAdd.slice(0, 10).forEach(([e, id]) => console.log(`   + ${e}  |  ${id || "(no id)"}`));
    if (toAdd.length > 10) console.log(`   ... and ${toAdd.length - 10} more`);
    toFill.slice(0, 5).forEach((f) => console.log(`   ~ row ${f.row}: ${f.email}  ->  ${f.id}`));

    if (!write) continue;

    // Write (RAW keeps IDs as text, so leading zeros etc. are not changed)
    if (toAdd.length) {
      const values = toAdd.map(([e, id]) => ["", e, id]);
      let startRow = rows.length + 1;
      if (rows.length === 0) {                       // empty tab: add a header first
        values.unshift(["Name", "Email", "Student ID"]);
        startRow = 1;
      }
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${q}!A${startRow}:C${startRow + values.length - 1}`,
        valueInputOption: "RAW",
        requestBody: { values },
      });
    }
    if (toFill.length) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          valueInputOption: "RAW",
          data: toFill.map((f) => ({ range: `${q}!C${f.row}`, values: [[f.id]] })),
        },
      });
    }
    console.log(`   written: ${toAdd.length} rows added, ${toFill.length} IDs filled`);
  }

  if (!write) console.log("\nDRY RUN: nothing was written. Add --write to apply.");
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
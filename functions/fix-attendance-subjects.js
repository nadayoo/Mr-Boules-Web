#!/usr/bin/env node
/**
 * Repairs attendance where students were saved under the WRONG subject, e.g. Edexcel students inside
 * a Cambridge attendance record (because Cambridge and Edexcel students were uploaded together).
 *
 * For every attendance record it finds students who belong to the OTHER subject only, and:
 *   1. Firestore: moves them out of that record and into the other subject's record for the same
 *      lesson (same title and date; one is created if there isn't one yet). A record left with nobody
 *      present is deleted, because an empty record would count everybody as absent.
 *   2. Google Sheet: moves their "Attended" mark to the right attendance tab (adding them there if they
 *      are missing, with their ID in column C) and clears the mark in the wrong tab.
 *      Add --remove-rows to also blank the rows that were added to the wrong tab and are now empty.
 *
 * From the project root:
 *   node functions/fix-attendance-subjects.js                 (dry run: changes nothing)
 *   node functions/fix-attendance-subjects.js --write
 *   node functions/fix-attendance-subjects.js --write --remove-rows
 */
const admin = require("firebase-admin");
const { google } = require("googleapis");

const SHEET_ID = "1-rCb-H83_NVvaBLKpI2z59xH49Jhn_5DNuCTHLUaAWc";
const TAB = { olcam: "Cambridge Attendance", oledx: "Edexcel Attendance" };
const OTHER = { olcam: "oledx", oledx: "olcam" };
const LABEL = { olcam: "Cambridge", oledx: "Edexcel" };

const lc = (e) => String(e || "").trim().toLowerCase();
const norm = (t) => String(t || "").trim().toLowerCase();
const lessonHeader = (title) => {
  const m = String(title || "").match(/(Lesson\s*\d+|Session\s*\d+)/i);
  return m ? m[0].trim() : String(title || "").trim();
};
function columnToLetter(col) {
  let letter = "";
  while (col > 0) {
    const t = (col - 1) % 26;
    letter = String.fromCharCode(t + 65) + letter;
    col = Math.floor((col - t - 1) / 26);
  }
  return letter;
}

async function main() {
  const write = process.argv.includes("--write");
  const removeRows = process.argv.includes("--remove-rows");

  const serviceAccount = require("./service-account.json");
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();
  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  // ---- students: email -> { id, subjects } ----
  const students = new Map();
  (await db.collection("students").get()).forEach((d) => {
    const x = d.data();
    const email = lc(x.email);
    if (!email) return;
    students.set(email, {
      id: String(x.id || "").trim(),
      subjects: new Set((Array.isArray(x.subjects) ? x.subjects : []).map((s) => String(s).toLowerCase())),
    });
  });

  // ---- attendance records of both subjects ----
  const records = { olcam: [], oledx: [] };
  for (const sub of ["olcam", "oledx"]) {
    (await db.collection(`${sub}_attendance`).get()).forEach((d) =>
      records[sub].push({ ref: d.ref, id: d.id, data: d.data() })
    );
  }

  // ---- find the students who are in the wrong subject's record ----
  const moves = [];
  for (const from of ["olcam", "oledx"]) {
    const to = OTHER[from];
    for (const rec of records[from]) {
      const emails = [...new Set((rec.data.presentEmails || []).map(lc))].filter((e) => {
        const st = students.get(e);
        return st && !st.subjects.has(from) && st.subjects.has(to);
      });
      if (emails.length) moves.push({ from, to, rec, emails });
    }
  }

  console.log(`Attendance records checked: ${records.olcam.length} Cambridge, ${records.oledx.length} Edexcel`);
  console.log(`Records with students in the wrong subject: ${moves.length}\n`);
  if (!moves.length) { console.log("Nothing to fix."); return; }

  // ---- the sheets, in memory ----
  const tabs = {};
  for (const sub of ["olcam", "oledx"]) {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${TAB[sub]}!A1:ZZ` });
    const rows = (res.data.values || []).map((r) => [...r]);
    if (!rows.length) rows.push(["Name", "Email", "Student ID"]);
    tabs[sub] = { rows, origLen: rows.length, origHeaderLen: rows[0].length, dirty: new Set(), blank: new Set(), headerChanged: false };
  }
  const findRow = (sub, email) => {
    const rows = tabs[sub].rows;
    for (let i = 1; i < rows.length; i++) if (lc(rows[i] && rows[i][1]) === email) return i;
    return -1;
  };
  const ensureColumn = (sub, header) => {
    const t = tabs[sub];
    let c = t.rows[0].indexOf(header);
    if (c === -1) { t.rows[0].push(header); c = t.rows[0].length - 1; t.headerChanged = true; }
    return c;
  };

  const stat = { cleared: 0, marked: 0, rowsAdded: 0 };
  for (const mv of moves) {
    const header = lessonHeader(mv.rec.data.title);
    for (const email of mv.emails) {
      const st = students.get(email);

      // wrong tab: clear the mark
      const wr = findRow(mv.from, email);
      if (wr !== -1) {
        const c = tabs[mv.from].rows[0].indexOf(header);
        if (c !== -1 && tabs[mv.from].rows[wr][c] === "Attended") {
          tabs[mv.from].rows[wr][c] = "";
          tabs[mv.from].dirty.add(`${wr},${c}`);
          stat.cleared++;
        }
        const r = tabs[mv.from].rows[wr];
        const hasMarks = r.slice(3).some((v) => String(v || "").trim() !== "");
        if (!hasMarks && !String(r[0] || "").trim()) tabs[mv.from].blank.add(wr);   // a row the old code added, now empty
      }

      // right tab: add the mark (and the student, if missing)
      const t = tabs[mv.to];
      const c = ensureColumn(mv.to, header);
      let rr = findRow(mv.to, email);
      if (rr === -1) {
        const row = new Array(Math.max(t.rows[0].length, 4)).fill("");
        row[1] = email; row[2] = st.id; row[c] = "Attended";
        t.rows.push(row);
        stat.rowsAdded++; stat.marked++;
      } else {
        const r = t.rows[rr];
        while (r.length <= c) r.push("");
        if (r[c] !== "Attended") { r[c] = "Attended"; t.dirty.add(`${rr},${c}`); stat.marked++; }
        if (!String(r[2] || "").trim() && st.id) { r[2] = st.id; t.dirty.add(`${rr},2`); }
      }
    }
  }

  // ---- report ----
  for (const mv of moves) {
    const ids = mv.emails.map((e) => students.get(e).id);
    const remaining = (mv.rec.data.presentEmails || []).map(lc).filter((e) => !mv.emails.includes(e)).length;
    console.log(`${mv.from}_attendance  "${mv.rec.data.title}" (${mv.rec.data.date || "no date"})`);
    console.log(`   ${mv.emails.length} ${LABEL[mv.to]} students -> ${mv.to}_attendance: ${ids.slice(0, 12).join(", ")}${ids.length > 12 ? " …" : ""}`);
    console.log(`   ${remaining ? `${remaining} students stay in this record` : "NOBODY left in this record, so it will be deleted"}`);
  }
  const blanks = tabs.olcam.blank.size + tabs.oledx.blank.size;
  console.log(`\nSheet: ${stat.marked} "Attended" marks to place in the right tab (${stat.rowsAdded} students to add there), ${stat.cleared} marks to clear in the wrong tab`);
  console.log(`       ${blanks} leftover rows in the wrong tab are now empty${removeRows ? " and will be blanked (--remove-rows)" : " (add --remove-rows to blank them)"}`);

  if (!write) { console.log("\nDRY RUN: nothing was changed. Add --write to apply."); return; }

  // ---- 1. Google Sheet first (so the sheet function finds the rows already there) ----
  for (const sub of ["olcam", "oledx"]) {
    const t = tabs[sub];
    const name = TAB[sub];
    if (t.headerChanged) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID, range: `${name}!A1`, valueInputOption: "USER_ENTERED", requestBody: { values: [t.rows[0]] },
      });
    }
    const data = [...t.dirty].map((k) => {
      const [r, c] = k.split(",").map(Number);
      return { range: `${name}!${columnToLetter(c + 1)}${r + 1}`, values: [[t.rows[r][c]]] };
    });
    if (data.length) {
      await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { valueInputOption: "USER_ENTERED", data } });
    }
    if (t.rows.length > t.origLen) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID, range: `${name}!A${t.origLen + 1}`, valueInputOption: "USER_ENTERED",
        requestBody: { values: t.rows.slice(t.origLen) },
      });
    }
    if (removeRows && t.blank.size) {
      await sheets.spreadsheets.values.batchClear({
        spreadsheetId: SHEET_ID,
        requestBody: { ranges: [...t.blank].map((r) => `${name}!A${r + 1}:ZZ${r + 1}`) },
      });
    }
  }

  // ---- 2. Firestore ----
  let created = 0, updated = 0, deleted = 0;
  for (const mv of moves) {
    const ids = mv.emails.map((e) => students.get(e).id);
    const target = records[mv.to].find(
      (r) => norm(r.data.title) === norm(mv.rec.data.title) && String(r.data.date || "") === String(mv.rec.data.date || "")
    );
    if (target) {
      const emails = [...new Set([...(target.data.presentEmails || []).map(lc), ...mv.emails])];
      const pids = [...new Set([...(target.data.presentIds || []), ...ids])];
      await target.ref.update({ presentEmails: emails, presentIds: pids });
      target.data.presentEmails = emails; target.data.presentIds = pids;
      updated++;
    } else {
      const data = {
        title: mv.rec.data.title, date: mv.rec.data.date || "", subject: mv.to,
        presentIds: ids, presentEmails: mv.emails, unlinkedIds: [],
        createdAt: admin.firestore.FieldValue.serverTimestamp(), movedFrom: mv.from,
      };
      const ref = await db.collection(`${mv.to}_attendance`).add(data);
      records[mv.to].push({ ref, id: ref.id, data });
      created++;
    }

    const movedIds = new Set(ids.map((i) => String(i).toUpperCase()));
    const left = (mv.rec.data.presentEmails || []).map(lc).filter((e) => !mv.emails.includes(e));
    if (!left.length) { await mv.rec.ref.delete(); deleted++; }
    else {
      await mv.rec.ref.update({
        presentEmails: left,
        presentIds: (mv.rec.data.presentIds || []).filter((i) => !movedIds.has(String(i).toUpperCase())),
      });
      updated++;
    }
  }
  console.log(`\nDone. Firestore: ${created} records created, ${updated} updated, ${deleted} emptied records deleted. Sheet updated.`);
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Moves student submission files into the right group subfolder, and updates the saved link in
 * Firestore so "View your file" keeps working. Every mode is a dry run until you add --write.
 *
 * MODE 1 - ONE STUDENT (good for testing):
 *   node functions/move-submissions.js --subject olcam --email student@gmail.com --lesson 2 --to-group 1
 *     moves that student's Lesson 2 files into  hw02/group-1/  and sets their record's group to 1.
 *     (leave out --lesson to do all of that student's lessons)
 *
 * MODE 2 - RECONCILE (tidies everyone):
 *   node functions/move-submissions.js --subject olcam --reconcile
 *     puts every file in  hw<lesson>/group-<group>/  using the lesson and group in its record's title.
 *     Files that no longer exist in Storage are reported and skipped.
 *
 * MODE 3 - FLAT FILES OF ONE GROUP:
 *   node functions/move-submissions.js --subject olcam --folder hw02 --group 5
 *     student-submissions/olcam/hw02/<file>.pdf  ->  .../hw02/group-5/<file>.pdf
 */
const admin = require("firebase-admin");
const crypto = require("crypto");

const BUCKET = "mr-boules.firebasestorage.app";

function getArg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return null;
  const next = process.argv[i + 1];
  return next && !next.startsWith("--") ? next : true;
}

const groupFromTitle = (t) => {
  const m = String(t || "").match(/Group\s*([A-Za-z0-9]+)/i);
  return m ? m[1].toLowerCase() : "";
};
const lessonFromTitle = (t) => {
  const m = String(t || "").match(/(?:Lesson|Lecture|Session)\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
};
const hwName = (n) => `hw${String(n).padStart(2, "0")}`;

async function main() {
  const subject = getArg("subject");
  const reconcile = process.argv.includes("--reconcile");
  const folder = getArg("folder");
  const group = String(getArg("group") || "").toLowerCase();
  const emailArg = getArg("email");
  const toGroup = String(getArg("to-group") || "").trim().toLowerCase();
  const lessonRaw = getArg("lesson");
  const lessonArg = lessonRaw && lessonRaw !== true ? parseInt(lessonRaw, 10) : null;
  const write = process.argv.includes("--write");

  const folderMode = folder && folder !== true && group && group !== "true";
  const studentMode = emailArg && emailArg !== true && toGroup && toGroup !== "true";
  if (!subject || subject === true || (!reconcile && !folderMode && !studentMode)) {
    console.error("Usage:");
    console.error("  node functions/move-submissions.js --subject olcam --email <email> [--lesson 2] --to-group 1 [--write]");
    console.error("  node functions/move-submissions.js --subject olcam --reconcile [--write]");
    console.error("  node functions/move-submissions.js --subject olcam --folder hw02 --group 5 [--write]");
    process.exit(1);
  }
  const email = studentMode ? String(emailArg).trim().toLowerCase() : "";

  const serviceAccount = require("./service-account.json");
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: BUCKET,
  });
  const bucket = admin.storage().bucket();
  const root = `student-submissions/${subject}/`;
  const prefix = folderMode ? `${root}${folder}/` : root;

  const snap = await admin.firestore().collection("submissions").where("subject", "==", subject).get();
  const candidates = [];
  const known = new Set();
  let inSubfolder = 0, otherGroup = 0, alreadyRight = 0, noGroup = 0;

  snap.forEach((d) => {
    const x = d.data();
    const p = x.path || "";
    if (!p.startsWith(root)) return;
    known.add(p);
    const g = String(x.group || "").trim().toLowerCase() || groupFromTitle(x.homeworkTitle);
    const parts = p.split("/");                         // student-submissions / subject / hwNN / [group-x] / file
    const file = parts[parts.length - 1];
    const lesson = lessonFromTitle(x.homeworkTitle);

    if (studentMode) {
      if (String(x.email || "").trim().toLowerCase() !== email) return;
      if (lessonArg !== null && lesson !== lessonArg) return;
      if (parts.length < 4) return;
      const hw = lesson !== null ? hwName(lesson) : parts[2];
      const newPath = `${parts[0]}/${parts[1]}/${hw}/group-${toGroup}/${file}`;
      if (p === newPath && g === toGroup) { alreadyRight++; return; }
      const oldTitle = String(x.homeworkTitle || "");
      candidates.push({
        ref: d.ref, path: p, rest: p.slice(root.length), email: x.email, newPath, group: toGroup, hw,
        extra: {
          homeworkTitle: oldTitle.replace(/Group\s*[A-Za-z0-9]+/i, `Group ${toGroup}`),
          movedFromGroup: g || null,
          movedAt: admin.firestore.FieldValue.serverTimestamp(),
          movedBy: "script",
        },
        note: g && g !== toGroup ? `(record: group ${g} -> ${toGroup})` : "",
      });
    } else if (reconcile) {
      if (!g) { noGroup++; return; }
      if (parts.length < 4) return;
      const hw = lesson !== null ? hwName(lesson) : parts[2];   // old uploads were numbered by post, so use the lesson
      const expected = `${parts[0]}/${parts[1]}/${hw}/group-${g}/${file}`;
      if (p === expected) { alreadyRight++; return; }
      candidates.push({ ref: d.ref, path: p, rest: p.slice(root.length), email: x.email, newPath: expected, group: g });
    } else {
      if (!p.startsWith(prefix)) return;
      const rest = p.slice(prefix.length);
      if (rest.includes("/")) { inSubfolder++; return; }
      if (g !== group) { otherGroup++; return; }
      candidates.push({ ref: d.ref, path: p, rest, email: x.email, newPath: `${prefix}group-${group}/${rest}`, group });
    }
  });

  // Extra files by the same student in those folders that no record points to (e.g. double-tap duplicates)
  const extras = [];
  if (studentMode) {
    const hwFolders = new Set(candidates.map((c) => c.hw));
    if (lessonArg !== null) hwFolders.add(hwName(lessonArg));
    for (const hw of hwFolders) {
      const [files] = await bucket.getFiles({ prefix: `${root}${hw}/` });
      for (const f of files) {
        const base = f.name.split("/").pop();
        if (!base.toLowerCase().startsWith(`${email}_`)) continue;
        if (known.has(f.name)) continue;
        const newPath = `${root}${hw}/group-${toGroup}/${base}`;
        if (f.name === newPath) continue;
        extras.push({ path: f.name, newPath, rest: f.name.slice(root.length) });
      }
    }
  }

  // Which files really exist in Storage? (old folders may have been deleted)
  let missing = [];
  if (reconcile) {
    const [all] = await bucket.getFiles({ prefix: root });
    const present = new Set(all.map((f) => f.name));
    missing = candidates.filter((c) => !present.has(c.path));
    const missingSet = new Set(missing.map((c) => c.path));
    for (let i = candidates.length - 1; i >= 0; i--) if (missingSet.has(candidates[i].path)) candidates.splice(i, 1);
  }

  let orphans = [];
  if (folderMode) {
    const [files] = await bucket.getFiles({ prefix, delimiter: "/" });
    orphans = files.map((f) => f.name).filter((n) => n !== prefix && !known.has(n));
  }

  // ---- report ----
  if (studentMode) {
    console.log(`Student: ${email}${lessonArg !== null ? `  |  Lesson ${lessonArg}` : "  |  all lessons"}  ->  Group ${toGroup}`);
    console.log(`Submission records to move: ${candidates.length}   (already correct: ${alreadyRight})`);
    candidates.forEach((c) => console.log(`   ${c.rest}\n      ->  ${c.newPath.slice(root.length)}  ${c.note}`));
    console.log(`Extra files by this student with no record (moved too): ${extras.length}`);
    extras.forEach((e) => console.log(`   ${e.rest}\n      ->  ${e.newPath.slice(root.length)}`));
    if (!candidates.length && !extras.length) console.log("Nothing to do for this student.");
  } else {
    console.log(reconcile ? `Reconcile: ${root}` : `Folder: ${prefix}`);
    console.log(`To move: ${candidates.length}`);
    if (reconcile) {
      console.log(`Already in the right folder: ${alreadyRight}${noGroup ? ` | skipped, record has no group: ${noGroup}` : ""}`);
      console.log(`File no longer in Storage (nothing to move): ${missing.length}`);
      missing.slice(0, 5).forEach((c) => console.log(`   missing: ${c.email}  ${c.rest}`));
    } else {
      console.log(`Left alone: ${otherGroup} from other groups, ${inSubfolder} already in a subfolder`);
      if (orphans.length) console.log(`Not linked to any submission (not touched): ${orphans.length}`);
    }
    candidates.slice(0, 15).forEach((c) => console.log(`   ${c.email}: ${c.rest}  ->  ${c.newPath.split("/").slice(2, 4).join("/")}`));
    if (candidates.length > 15) console.log(`   ... and ${candidates.length - 15} more`);
  }

  if (!write) {
    console.log("\nDRY RUN: nothing was moved. Add --write to apply.");
    return;
  }

  // ---- move: copy -> update Firestore -> delete the old file ----
  let moved = 0, failed = 0;
  for (const c of candidates) {
    try {
      const src = bucket.file(c.path);
      const dst = bucket.file(c.newPath);
      const [srcExists] = await src.exists();
      if (!srcExists) { console.log(`   missing, skipped: ${c.path}`); failed++; continue; }
      const [dstExists] = await dst.exists();
      if (dstExists && c.path !== c.newPath) { console.log(`   already exists, skipped: ${c.newPath}`); failed++; continue; }

      if (c.path !== c.newPath) {
        await src.copy(dst);
        const [meta] = await dst.getMetadata();
        let token = String((meta.metadata && meta.metadata.firebaseStorageDownloadTokens) || "").split(",")[0];
        if (!token) {
          token = crypto.randomUUID();
          await dst.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } });
        }
        const url = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(c.newPath)}?alt=media&token=${token}`;
        await c.ref.update({ path: c.newPath, url, group: c.group, ...(c.extra || {}) });
        await src.delete();
      } else {
        await c.ref.update({ group: c.group, ...(c.extra || {}) });     // file already in place, only fix the record
      }
      moved++;
    } catch (err) {
      console.error(`   FAILED ${c.path}: ${err.message}`);
      failed++;
    }
  }
  for (const e of extras) {
    try {
      const src = bucket.file(e.path);
      const dst = bucket.file(e.newPath);
      const [dstExists] = await dst.exists();
      if (dstExists) { console.log(`   already exists, skipped: ${e.newPath}`); failed++; continue; }
      await src.copy(dst);
      await src.delete();
      moved++;
    } catch (err) {
      console.error(`   FAILED ${e.path}: ${err.message}`);
      failed++;
    }
  }
  console.log(`\nDone. Moved ${moved}, skipped/failed ${failed}.`);
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
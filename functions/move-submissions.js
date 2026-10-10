#!/usr/bin/env node
/**
 * Moves old (flat) student submission files into a group subfolder, and updates the
 * saved link in Firestore so "View your file" keeps working.
 *
 *   before:  student-submissions/olcam/hw01/<file>.pdf
 *   after:   student-submissions/olcam/hw01/group-5/<file>.pdf
 *
 * Only submissions whose homework title says that group (e.g. "Lesson 1, Group 5: ...")
 * are moved. Files in other groups, and files already in a subfolder, are not touched.
 *
 * From the project root (dry run first: writes nothing):
 *   node functions/move-submissions.js --subject olcam --folder hw01 --group 5
 * Then, to actually move:
 *   node functions/move-submissions.js --subject olcam --folder hw01 --group 5 --write
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

async function main() {
  const subject = getArg("subject");
  const folder = getArg("folder");
  const group = String(getArg("group") || "").toLowerCase();
  const write = process.argv.includes("--write");

  if (!subject || subject === true || !folder || folder === true || !group || group === "true") {
    console.error("Usage: node functions/move-submissions.js --subject olcam --folder hw01 --group 5 [--write]");
    process.exit(1);
  }

  const serviceAccount = require("./service-account.json");
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: BUCKET,
  });
  const bucket = admin.storage().bucket();
  const prefix = `student-submissions/${subject}/${folder}/`;

  // 1. Find the submissions to move
  const snap = await admin.firestore().collection("submissions").where("subject", "==", subject).get();
  const candidates = [];
  const known = new Set();
  let inSubfolder = 0, otherGroup = 0;

  snap.forEach((d) => {
    const x = d.data();
    const p = x.path || "";
    if (!p.startsWith(prefix)) return;
    known.add(p);
    const rest = p.slice(prefix.length);
    if (rest.includes("/")) { inSubfolder++; return; }                  // already in a subfolder
    const g = String(x.group || "").toLowerCase() || groupFromTitle(x.homeworkTitle);
    if (g !== group) { otherGroup++; return; }
    candidates.push({ ref: d.ref, path: p, rest, email: x.email, newPath: `${prefix}group-${group}/${rest}` });
  });

  // 2. Files in the folder that no submission points to (never moved)
  const [files] = await bucket.getFiles({ prefix, delimiter: "/" });
  const orphans = files.map((f) => f.name).filter((n) => n !== prefix && !known.has(n));

  console.log(`Folder: ${prefix}`);
  console.log(`To move into group-${group}/: ${candidates.length}`);
  console.log(`Left alone: ${otherGroup} from other groups, ${inSubfolder} already in a subfolder`);
  if (orphans.length) console.log(`Not linked to any submission (not touched): ${orphans.length}`);
  candidates.slice(0, 10).forEach((c) => console.log(`   ${c.email}  ${c.rest}`));
  if (candidates.length > 10) console.log(`   ... and ${candidates.length - 10} more`);

  if (!write) {
    console.log("\nDRY RUN: nothing was moved. Add --write to apply.");
    return;
  }

  // 3. Move: copy -> update Firestore -> delete the old file
  let moved = 0, failed = 0;
  for (const c of candidates) {
    try {
      const src = bucket.file(c.path);
      const dst = bucket.file(c.newPath);
      const [srcExists] = await src.exists();
      if (!srcExists) { console.log(`   missing, skipped: ${c.path}`); failed++; continue; }
      const [dstExists] = await dst.exists();
      if (dstExists) { console.log(`   already exists, skipped: ${c.newPath}`); failed++; continue; }

      await src.copy(dst);

      const [meta] = await dst.getMetadata();
      let token = String((meta.metadata && meta.metadata.firebaseStorageDownloadTokens) || "").split(",")[0];
      if (!token) {
        token = crypto.randomUUID();
        await dst.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } });
      }
      const url = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(c.newPath)}?alt=media&token=${token}`;

      await c.ref.update({ path: c.newPath, url, group });
      await src.delete();
      moved++;
    } catch (err) {
      console.error(`   FAILED ${c.path}: ${err.message}`);
      failed++;
    }
  }
  console.log(`\nDone. Moved ${moved}, skipped/failed ${failed}.`);
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Moves student submission files into the right group subfolder, and updates the saved link in
 * Firestore so "View your file" keeps working.
 *
 * MODE 1 - flat files of one group (old behaviour):
 *   node functions/move-submissions.js --subject olcam --folder hw02 --group 5
 *     student-submissions/olcam/hw02/<file>.pdf  ->  student-submissions/olcam/hw02/group-5/<file>.pdf
 *
 * MODE 2 - reconcile (use after "Fix Groups" in the admin panel):
 *   node functions/move-submissions.js --subject olcam --reconcile
 *     moves every file whose folder doesn't match its record's group, e.g.
 *     .../hw02/group-5/<file>.pdf  ->  .../hw02/group-1/<file>.pdf   (if the record now says group 1)
 *
 * Both modes are a dry run (nothing changes) until you add --write.
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
  const reconcile = process.argv.includes("--reconcile");
  const folder = getArg("folder");
  const group = String(getArg("group") || "").toLowerCase();
  const write = process.argv.includes("--write");

  const folderMode = folder && folder !== true && group && group !== "true";
  if (!subject || subject === true || (!reconcile && !folderMode)) {
    console.error("Usage:");
    console.error("  node functions/move-submissions.js --subject olcam --folder hw02 --group 5 [--write]");
    console.error("  node functions/move-submissions.js --subject olcam --reconcile [--write]");
    process.exit(1);
  }

  const serviceAccount = require("./service-account.json");
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: BUCKET,
  });
  const bucket = admin.storage().bucket();
  const root = `student-submissions/${subject}/`;
  const prefix = reconcile ? root : `${root}${folder}/`;

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

    if (reconcile) {
      if (!g) { noGroup++; return; }
      const parts = p.split("/");                       // student-submissions / subject / hwNN / [group-x] / file
      if (parts.length < 4) return;
      const file = parts[parts.length - 1];
      const expected = `${parts.slice(0, 3).join("/")}/group-${g}/${file}`;
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

  let orphans = [];
  if (!reconcile) {
    const [files] = await bucket.getFiles({ prefix, delimiter: "/" });
    orphans = files.map((f) => f.name).filter((n) => n !== prefix && !known.has(n));
  }

  console.log(reconcile ? `Reconcile: ${root}` : `Folder: ${prefix}`);
  console.log(`To move: ${candidates.length}`);
  if (reconcile) {
    console.log(`Already in the right folder: ${alreadyRight}${noGroup ? ` | skipped, record has no group: ${noGroup}` : ""}`);
  } else {
    console.log(`Left alone: ${otherGroup} from other groups, ${inSubfolder} already in a subfolder`);
    if (orphans.length) console.log(`Not linked to any submission (not touched): ${orphans.length}`);
  }
  candidates.slice(0, 15).forEach((c) => console.log(`   ${c.email}: ${c.rest}  ->  group-${c.group}`));
  if (candidates.length > 15) console.log(`   ... and ${candidates.length - 15} more`);

  if (!write) {
    console.log("\nDRY RUN: nothing was moved. Add --write to apply.");
    return;
  }

  // Move: copy -> update Firestore -> delete the old file
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

      await c.ref.update({ path: c.newPath, url, group: c.group });
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

// One-off: fingerprints the homework files that were submitted BEFORE the duplicate check existed, so old duplicates are
// found too. It downloads every PDF once, so it can take a while for a big class.
//
//   node functions/backfill-hashes.js               -> only says how many files it would do (changes nothing)
//   node functions/backfill-hashes.js --write       -> does it
//   node functions/backfill-hashes.js --write --limit 200   -> only the first 200 (oldest first), to try it out
//
// Files are done oldest first, so when two students have the same file the LATER one is the one that is flagged.
// Run it from the project root. It needs functions/service-account.json, like fix-attendance-subjects.js.
const admin = require("firebase-admin");
const { checkSubmission } = require("./duplicates");

async function main() {
  const write = process.argv.includes("--write");
  const li = process.argv.indexOf("--limit");
  const limit = li >= 0 ? parseInt(process.argv[li + 1], 10) : Infinity;

  const serviceAccount = require("./service-account.json");
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount), storageBucket: process.env.STORAGE_BUCKET || `${serviceAccount.project_id}.firebasestorage.app` });
  const db = admin.firestore();
  const bucket = admin.storage().bucket();

  const snap = await db.collection("submissions").get();
  const todo = [];
  snap.forEach((d) => {
    const x = d.data();
    if (x.path && (x.fileType || "pdf") === "pdf" && x.hashedPath !== x.path) todo.push({ subId: d.id, data: x });
  });
  const when = (x) => { const t = x.replacedAt || x.submittedAt; return t && t.toMillis ? t.toMillis() : 0; };
  todo.sort((a, b) => when(a.data) - when(b.data));
  const batch = todo.slice(0, limit);
  console.log(`${snap.size} submissions, ${todo.length} not fingerprinted yet${limit !== Infinity ? `, doing ${batch.length}` : ""}.`);
  if (!write) { console.log("Dry run: nothing was changed. Add --write to do it."); return; }

  let done = 0, flagged = 0, failed = 0;
  for (const item of batch) {
    const r = await checkSubmission({ db, bucket, subId: item.subId, data: item.data });
    if (!r) failed++; else { done++; if (r.dup) flagged++; }
    if ((done + failed) % 25 === 0) console.log(`  ${done + failed}/${batch.length}`);
  }
  console.log(`Done. Fingerprinted ${done}, flagged ${flagged} as the same file as another student's, could not read ${failed}.`);
}
main().catch((e) => { console.error(e); process.exit(1); });

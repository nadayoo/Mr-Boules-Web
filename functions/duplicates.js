// Spots a homework file that is IDENTICAL (byte for byte) to a file another student already submitted.
//
// It runs on the server whenever a submission is saved: it downloads the stored PDF, works out its SHA-256 fingerprint and
// looks for other students' submissions with the same fingerprint. If there are any, the submission is marked
//   dup: true,  dupOf: [ { email, homeworkId, homeworkTitle, hwCode, group, url, submittedAt } ... ]
// and the "Blank files" panel lists it for an admin to look at. Nothing is shown to students and nobody is blocked.
//
// What it catches: one student sending their file to another who uploads it unchanged (WhatsApp, email and downloads do not
// change a file). What it does NOT catch: a file that was photographed, screenshotted or exported again, handwritten copies,
// or answers that are the same but typed or written out again.
const admin = require("firebase-admin");
const functions = require("firebase-functions/v1");
const crypto = require("crypto");

const MAX_BYTES = 60 * 1024 * 1024;     // bigger files are skipped
const MAX_LINKS = 5;                    // how many earlier submissions are listed on a flagged one
const SCAN_LIMIT = 10;

async function hashStoredFile(bucket, path) {
  const file = bucket.file(path);
  const [meta] = await file.getMetadata();
  if (Number(meta.size) > MAX_BYTES) return null;
  const [buf] = await file.download();
  return crypto.createHash("sha256").update(buf).digest("hex");
}

const lc = (e) => String(e || "").trim().toLowerCase();

// Does the work for one submission. Returns what was saved, or null when nothing needed doing.
async function checkSubmission({ db, bucket, subId, data }) {
  if (!data || !data.path) return null;
  if (data.fileType && data.fileType !== "pdf") return null;
  if (data.hashedPath === data.path) return null;        // this stored file was already fingerprinted (also stops a loop: the
                                                         // updates below trigger this function again)
  let hash;
  try { hash = await hashStoredFile(bucket, data.path); }
  catch (e) { console.error("Could not read", data.path, e.message); return null; }
  if (!hash) return null;

  const ref = db.collection("submissions").doc(subId);
  // The fingerprint is saved FIRST, so two identical files uploaded at the same moment can see each other
  await ref.update({ fileHash: hash, hashedPath: data.path });

  const dupOf = [];
  if (!data.blank) {                                      // blank files / the bare question sheet are already flagged as such
    const snap = await db.collection("submissions").where("fileHash", "==", hash).limit(SCAN_LIMIT).get();
    snap.forEach((d) => {
      if (d.id === subId) return;
      const x = d.data();
      if (x.blank) return;
      if (lc(x.email) === lc(data.email)) return;         // the same student sending the same file twice is not copying
      dupOf.push({
        subId: d.id, email: x.email || "", homeworkId: x.homeworkId || "", homeworkTitle: x.homeworkTitle || "",
        hwCode: x.hwCode || "", group: x.group || "", url: x.url || "", submittedAt: x.submittedAt || null,
      });
    });
  }
  const result = { dup: dupOf.length > 0, dupOf: dupOf.slice(0, MAX_LINKS), dupChecked: true };
  await ref.update(result);
  return { fileHash: hash, ...result };
}

exports.onSubmissionWritten = functions.firestore
  .document("submissions/{subId}")
  .onWrite(async (change, context) => {
    if (!change.after.exists) return null;
    return checkSubmission({
      db: admin.firestore(),
      bucket: admin.storage().bucket(),
      subId: context.params.subId,
      data: change.after.data(),
    });
  });

exports.checkSubmission = checkSubmission;

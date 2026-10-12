const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const crypto = require("crypto");

const BUCKET = "mr-boules.firebasestorage.app";

// A submission's group: its own `group` field, else the "Group N" in its title (older records)
function groupOf(x) {
  const own = String((x && x.group) || "").trim().toLowerCase();
  if (own) return own;
  const m = String((x && x.homeworkTitle) || "").match(/Group\s*([A-Za-z0-9]+)/i);
  return m ? m[1].toLowerCase() : "";
}

// When an admin switches a student's group (Fix Groups panel), move their file into the new
// group's folder and update the saved link:
//   student-submissions/olcam/hw02/group-5/<file>  ->  student-submissions/olcam/hw02/group-1/<file>
//
// This only listens for UPDATES to a submission whose group changed. It never runs on a new
// submission, so it has nothing to do with the Google Sheet function (which runs on create).
exports.onSubmissionGroupChanged = functions.firestore
  .document("submissions/{docId}")
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();

    if (after.subject !== "olcam") return null;                   // only Cambridge has groups
    if (groupOf(before) === groupOf(after)) return null;          // group didn't change (also stops loops)

    const g = groupOf(after);
    const oldPath = after.path || "";
    if (!g || !oldPath.startsWith("student-submissions/")) return null;

    const parts = oldPath.split("/");                             // student-submissions / olcam / hw02 / [group-x] / file
    if (parts.length < 4) return null;
    const newPath = `${parts.slice(0, 3).join("/")}/group-${g}/${parts[parts.length - 1]}`;
    if (newPath === oldPath) return null;

    const bucket = admin.storage().bucket(BUCKET);
    const src = bucket.file(oldPath);
    const dst = bucket.file(newPath);

    const [srcExists] = await src.exists();
    if (!srcExists) {
      console.warn(`Not moved, file missing: ${oldPath}`);
      return null;
    }
    const [dstExists] = await dst.exists();
    if (dstExists) {
      console.warn(`Not moved, destination already exists: ${newPath}`);
      return null;
    }

    await src.copy(dst);

    const [meta] = await dst.getMetadata();
    let token = String((meta.metadata && meta.metadata.firebaseStorageDownloadTokens) || "").split(",")[0];
    if (!token) {
      token = crypto.randomUUID();
      await dst.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } });
    }
    const url = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(newPath)}?alt=media&token=${token}`;

    // Point the record at the new file first, and only then delete the old one
    await change.after.ref.update({ path: newPath, url });
    await src.delete();

    console.log(`Moved ${oldPath} -> ${newPath}`);
    return null;
  });

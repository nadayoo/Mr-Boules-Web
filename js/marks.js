import { db, storage, toast } from './config.js';
import { collection, doc, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { ref, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import JSZip from "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm";
import { state } from './auth.js';

// CSV text -> rows. Columns: id, email, mark, grade (grade is optional).
// A header line ("id,email,mark,grade") and an Excel BOM are ignored.
// A row whose second column is not an email is skipped (this catches a wrong column order).
export function parseMarksCsv(csvText) {
  const lines = String(csvText || '').replace(/^\uFEFF/, '').split('\n').map(l => l.trim()).filter(l => l);
  const rows = [];
  lines.forEach((line, i) => {
    const parts = line.split(',').map(s => s.trim().replace(/^"(.*)"$/, '$1').trim());
    if (i === 0 && /^(id|email)$/i.test(parts[0])) return;     // header row
    if (parts.length < 3) return;
    const [id, email, mark, grade = ''] = parts;
    if (!id || !email || !mark) return;
    if (!email.includes('@')) return;                          // not an email -> wrong column order
    rows.push({ email, mark, id, grade });
  });
  return { rows, lineCount: lines.length };
}

function fmtEta(sec) {
  if (!isFinite(sec) || sec < 0) return '';
  if (sec < 60) return `~${Math.max(1, Math.round(sec))}s left`;
  return `~${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s left`;
}

// Upload one file and report 0..1 while it goes
function uploadFile(storageRef, blob, onFraction) {
  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, blob);
    task.on('state_changed',
      (s) => onFraction(s.totalBytes ? s.bytesTransferred / s.totalBytes : 0),
      reject,
      () => resolve(task.snapshot));
  });
}

export async function processMarksUpload(subject, quizTitle, csvText, zipFile, onProgress = () => {}) {
  const { rows, lineCount } = parseMarksCsv(csvText);
  if (lineCount < 1) {
    toast('CSV is empty', 'ti-alert-triangle');
    return;
  }

  // Load ZIP
  onProgress(0, 'Reading ZIP…');
  let zip;
  try {
    zip = await JSZip.loadAsync(zipFile);
  } catch (err) {
    console.error(err);
    toast('Invalid ZIP file', 'ti-alert-triangle');
    return;
  }

  // Build a map of filename (lowercase) → file
  const pdfMap = {};
  zip.forEach((relativePath, file) => {
    if (!file.dir && relativePath.toLowerCase().endsWith('.pdf')) {
      const name = relativePath.split('/').pop().toLowerCase(); // just the filename
      pdfMap[name] = file;
    }
  });

  // How many PDFs will really be uploaded (this is what the bar counts)
  const totalPdfs = rows.filter(r => pdfMap[`${r.id.toUpperCase().replace(/[^A-Z0-9]/g, '').toLowerCase()}.pdf`]).length;
  let donePdfs = 0;
  const startedAt = Date.now();
  const report = (fraction = 0) => {
    if (!totalPdfs) return;
    const overall = Math.min(1, (donePdfs + fraction) / totalPdfs);
    const elapsed = (Date.now() - startedAt) / 1000;
    const eta = overall > 0.03 && elapsed > 2 ? fmtEta(elapsed * (1 - overall) / overall) : '';
    onProgress(overall, `Uploading PDFs ${Math.min(donePdfs + 1, totalPdfs)} of ${totalPdfs}`, eta);
  };
  report(0);

  let batch = writeBatch(db);
  let count = 0;
  let missingPdfs = 0;

  for (const row of rows) {
    const { email, mark, id, grade } = row;

    const cleanId = id.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const pdfName = `${cleanId.toLowerCase()}.pdf`;
    const pdfFile = pdfMap[pdfName];

    let pdfUrl = '';

    if (pdfFile) {
      try {
        const blob = await pdfFile.async('blob');
        const path = `marks-pdfs/${subject}/${Date.now()}_${cleanId}.pdf`;
        const storageRef = ref(storage, path);
        const snapshot = await uploadFile(storageRef, blob, report);
        pdfUrl = await getDownloadURL(snapshot.ref);
      } catch (uploadErr) {
        console.error('PDF upload failed for', cleanId, uploadErr);
        missingPdfs++;
      }
      donePdfs++;
      report(0);
    } else {
      missingPdfs++;
    }

    const markRef = doc(db, `${subject}_marks`, `${email.toLowerCase()}_${Date.now()}_${count}`);
    batch.set(markRef, {
      email: email.toLowerCase(),
      quiz: quizTitle,
      mark: mark,
      grade: grade,
      id: cleanId,
      pdfUrl: pdfUrl,
      createdAt: serverTimestamp(),
      postedBy: state.userEmail || ''
    });
    count++;

    // Firestore batch limit is 500
    if (count % 500 === 0) {
      await batch.commit();
      batch = writeBatch(db);
    }
  }

  if (count > 0) {
    onProgress(1, 'Saving marks…', '');
    if (count % 500 !== 0) await batch.commit();
    let msg = `Successfully uploaded ${count} marks`;
    if (missingPdfs > 0) msg += ` (${missingPdfs} PDFs missing)`;
    toast(msg);
  } else {
    toast('No valid rows found. CSV columns must be: id, email, mark, grade', 'ti-alert-triangle');
  }
}

// The progress bar lives in the marks modal, just above the buttons
function createProgressBar() {
  const footer = document.querySelector('#modal .modal-footer');
  if (!footer) return () => {};
  const box = document.createElement('div');
  box.className = 'upload-progress';
  box.innerHTML = `
    <div class="upload-progress-top"><span class="up-text">Starting…</span><span class="up-pct">0%</span></div>
    <div class="upload-progress-track"><div class="upload-progress-fill"></div></div>
    <div class="upload-progress-eta"></div>`;
  footer.parentNode.insertBefore(box, footer);
  const text = box.querySelector('.up-text');
  const pct = box.querySelector('.up-pct');
  const fill = box.querySelector('.upload-progress-fill');
  const eta = box.querySelector('.upload-progress-eta');
  return (fraction, label, etaText = '') => {
    const p = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
    fill.style.width = `${p}%`;
    pct.textContent = `${p}%`;
    if (label) text.textContent = label;
    eta.textContent = etaText;
  };
}

window.handleMarksUpload = async (subject) => {
  const quizTitle = document.getElementById('m-quiz-title').value.trim();
  const csvInput = document.getElementById('m-csv-file');
  const zipInput = document.getElementById('m-zip-file');
  const btn = document.getElementById('m-upload-btn');

  if (!quizTitle) {
    toast('Please enter a quiz title', 'ti-alert-triangle');
    return;
  }
  if (!csvInput.files[0]) {
    toast('Please select a CSV file', 'ti-alert-triangle');
    return;
  }
  if (!zipInput.files[0]) {
    toast('Please select a ZIP file', 'ti-alert-triangle');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Uploading…';
  const setProgress = createProgressBar();

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      await processMarksUpload(subject, quizTitle, e.target.result, zipInput.files[0], setProgress);
      setProgress(1, 'Done');
      setTimeout(() => window.closeModal(), 600);
    } catch (err) {
      console.error(err);
      toast('Upload failed', 'ti-alert-triangle');
      btn.disabled = false;
      btn.textContent = 'Upload Marks';
    }
  };
  reader.readAsText(csvInput.files[0]);
};

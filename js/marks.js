import { db, storage, toast } from './config.js';
import { collection, doc, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import JSZip from "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm";

export async function processMarksUpload(subject, quizTitle, csvText, zipFile) {
  const lines = csvText.split('\n').map(l => l.trim()).filter(l => l);
  if (lines.length < 1) {
    toast('CSV is empty', 'ti-alert-triangle');
    return;
  }

  // Load ZIP
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

  const batch = writeBatch(db);
  let count = 0;
  let missingPdfs = 0;

  for (const line of lines) {
    // Expected format: email,mark,id
    const parts = line.split(',').map(s => s.trim());
    if (parts.length < 3) continue;

    const [email, mark, id] = parts;
    if (!email || !mark || !id) continue;

    const cleanId = id.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const pdfName = `${cleanId.toLowerCase()}.pdf`;
    const pdfFile = pdfMap[pdfName];

    let pdfUrl = '';

    if (pdfFile) {
      try {
        const blob = await pdfFile.async('blob');
        const path = `marks-pdfs/${subject}/${Date.now()}_${cleanId}.pdf`;
        const storageRef = ref(storage, path);
        const snapshot = await uploadBytes(storageRef, blob);
        pdfUrl = await getDownloadURL(snapshot.ref);
      } catch (uploadErr) {
        console.error('PDF upload failed for', cleanId, uploadErr);
        missingPdfs++;
      }
    } else {
      missingPdfs++;
    }

    const markRef = doc(db, `${subject}_marks`, `${email.toLowerCase()}_${Date.now()}_${count}`);
    batch.set(markRef, {
      email: email.toLowerCase(),
      quiz: quizTitle,
      mark: mark,
      id: cleanId,
      pdfUrl: pdfUrl,
      createdAt: serverTimestamp()
    });
    count++;

    // Firestore batch limit is 500
    if (count % 500 === 0) {
      await batch.commit();
    }
  }

  if (count > 0) {
    await batch.commit();
    let msg = `Successfully uploaded ${count} marks`;
    if (missingPdfs > 0) msg += ` (${missingPdfs} PDFs missing)`;
    toast(msg);
  } else {
    toast('No valid rows found in CSV', 'ti-alert-triangle');
  }
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

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      await processMarksUpload(subject, quizTitle, e.target.result, zipInput.files[0]);
      window.closeModal();
    } catch (err) {
      console.error(err);
      toast('Upload failed', 'ti-alert-triangle');
      btn.disabled = false;
      btn.textContent = 'Upload Marks';
    }
  };
  reader.readAsText(csvInput.files[0]);
};
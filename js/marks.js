import { db, toast } from './config.js';
import { collection, doc, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export async function processMarksCSV(subject, quizTitle, csvText) {
  const lines = csvText.split('\n').map(l => l.trim()).filter(l => l);
  if (lines.length < 1) { toast('CSV is empty', 'ti-alert-triangle'); return; }

  const batch = writeBatch(db);
  let count = 0;

  for (const line of lines) {
    // Expected format: email,mark
    const [email, mark] = line.split(',').map(s => s.trim());
    if (!email || !mark) continue;

    const markRef = doc(db, `${subject}_marks`, `${email}_${Date.now()}_${count}`);
    batch.set(markRef, {
      email: email.toLowerCase(),
      quiz: quizTitle,
      mark: mark,
      createdAt: serverTimestamp()
    });
    count++;
    
    // Firestore batch limit is 500
    if (count % 500 === 0) {
      await batch.commit();
      // Reset batch if needed for more than 500
    }
  }

  if (count > 0) {
    await batch.commit();
    toast(`Successfully uploaded ${count} marks!`);
  } else {
    toast('No valid marks found in CSV', 'ti-alert-triangle');
  }
}

window.handleMarksUpload = async (subject) => {
  const quizTitle = document.getElementById('m-quiz-title').value.trim();
  const fileInput = document.getElementById('m-csv-file');
  const btn = document.getElementById('m-upload-btn');

  if (!quizTitle) { toast('Please enter a quiz title', 'ti-alert-triangle'); return; }
  if (!fileInput.files[0]) { toast('Please select a CSV file', 'ti-alert-triangle'); return; }

  btn.disabled = true;
  btn.textContent = 'Uploading...';

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      await processMarksCSV(subject, quizTitle, e.target.result);
      window.closeModal();
    } catch (err) {
      console.error(err);
      toast('Upload failed', 'ti-alert-triangle');
      btn.disabled = false;
      btn.textContent = 'Upload Marks';
    }
  };
  reader.readAsText(fileInput.files[0]);
};

import { db, toast } from './config.js';
import {
  collection,
  addDoc,
  getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { closeModal } from './modal.js';

/**
 * Handles uploading attendance CSV, parsing IDs, mapping IDs to emails, 
 * and saving the record to Firestore.
 */
export async function handleAttendanceUpload(subject) {
  const sessionTitle = document.getElementById('att-session-name')?.value?.trim();
  const sessionDate = document.getElementById('att-date')?.value;
  const fileInput = document.getElementById('att-csv-file');
  const btn = document.getElementById('att-upload-btn');

  if (!sessionTitle) {
    toast('Please enter a session title', 'ti-alert-triangle');
    return;
  }
  if (!sessionDate) {
    toast('Please select a date', 'ti-alert-triangle');
    return;
  }
  if (!fileInput?.files?.[0]) {
    toast('Please select a CSV file', 'ti-alert-triangle');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Processing…';

  try {
    const file = fileInput.files[0];
    const rawText = await file.text();

    // 1. Clean carriage returns (\r) and split lines into trimmed IDs
    const validIds = rawText
      .split(/\r?\n/)
      .map(id => id.trim())
      .filter(id => id.length > 0);

    if (validIds.length === 0) {
      toast('CSV file is empty or invalid', 'ti-alert-triangle');
      btn.disabled = false;
      btn.textContent = 'Upload';
      return;
    }

    // 2. Fetch all registered students from Firestore to build ID -> Email map
    const studentsSnap = await getDocs(collection(db, 'students'));
    const idToEmailMap = {};

    studentsSnap.forEach(docSnap => {
      const data = docSnap.data();
      if (data.id && data.email) {
        idToEmailMap[data.id.trim().toUpperCase()] = data.email.trim().toLowerCase();
      }
    });

    // 3. Match CSV IDs with registered emails
    const presentEmails = [];
    const unlinkedIds = [];

    validIds.forEach(id => {
      const cleanId = id.toUpperCase();
      if (idToEmailMap[cleanId]) {
        presentEmails.push(idToEmailMap[cleanId]);
      } else {
        unlinkedIds.push(cleanId);
      }
    });

    // 4. Save attendance document
    await addDoc(collection(db, `${subject}_attendance`), {
      title: sessionTitle,
      date: sessionDate,
      subject: subject,
      presentIds: validIds,
      presentEmails: presentEmails,
      unlinkedIds: unlinkedIds,
      createdAt: serverTimestamp()
    });

    closeModal();
    toast(`Attendance uploaded (${presentEmails.length} students matched)`);
  } catch (err) {
    console.error('Attendance upload error:', err);
    toast('Failed to upload attendance', 'ti-alert-triangle');
    btn.disabled = false;
    btn.textContent = 'Upload';
  }
}

// Bind to window object for global usage across components
window.handleAttendanceUpload = handleAttendanceUpload;
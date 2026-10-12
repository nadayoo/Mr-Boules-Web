const functions = require("firebase-functions/v1");
const { handleAttendanceCreated } = require("./attendanceSheet");

exports.onOlcamAttendanceCreated = functions.firestore
  .document("olcam_attendance/{docId}")
  .onCreate((snap, context) =>
    handleAttendanceCreated(snap, { params: { subject: "olcam" } })
  );

exports.onOledxAttendanceCreated = functions.firestore
  .document("oledx_attendance/{docId}")
  .onCreate((snap, context) =>
    handleAttendanceCreated(snap, { params: { subject: "oledx" } })
  );

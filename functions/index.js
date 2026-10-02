const admin = require("firebase-admin");

admin.initializeApp();

// Homework -> Google Sheet ("OL Cambridge" / "OL Edexcel" tabs)
const homework = require("./homework");
exports.onSubmissionCreated = homework.onSubmissionCreated;

// Attendance -> Google Sheet ("Cambridge Attendance" / "Edexcel Attendance" tabs)
const attendance = require("./attendance");
exports.onOlcamAttendanceCreated = attendance.onOlcamAttendanceCreated;
exports.onOledxAttendanceCreated = attendance.onOledxAttendanceCreated;

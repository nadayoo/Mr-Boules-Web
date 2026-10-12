const admin = require("firebase-admin");

admin.initializeApp();

// Homework -> Google Sheet ("OL Cambridge" / "OL Edexcel" tabs)
const homework = require("./homework");
exports.onSubmissionCreated = homework.onSubmissionCreated;

// Attendance -> Google Sheet ("Cambridge Attendance" / "Edexcel Attendance" tabs)
const attendance = require("./attendance");
exports.onOlcamAttendanceCreated = attendance.onOlcamAttendanceCreated;
exports.onOledxAttendanceCreated = attendance.onOledxAttendanceCreated;

// Fix Groups panel: when a submission's group is changed, move its file into the new group's folder
const groupFolders = require("./groupFolders");
exports.onSubmissionGroupChanged = groupFolders.onSubmissionGroupChanged;

// Runs automatically before every hosting deploy (see "predeploy" in firebase.json).
// Writes a fresh version number into version.json and js/version.js.
// It only touches those two files. It does not touch functions/.
const fs = require("fs");
const path = require("path");

const d = new Date();
const p = (n) => String(n).padStart(2, "0");
const version = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;

fs.writeFileSync(path.join(__dirname, "version.json"), JSON.stringify({ version }) + "\n");
fs.writeFileSync(
  path.join(__dirname, "js", "version.js"),
  `// Updated automatically on every deploy by stamp-version.js. Do not edit by hand.\nexport const APP_VERSION = "${version}";\n`
);
console.log("Stamped version", version);

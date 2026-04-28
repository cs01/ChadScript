import crypto from "node:crypto";
const bytes = crypto.randomBytes(16).toString("hex");
console.log(bytes.length);
console.log(typeof bytes);

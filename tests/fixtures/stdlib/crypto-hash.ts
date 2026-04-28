import crypto from "node:crypto";
const hash = crypto.createHash("sha256").update("hello").digest("hex");
console.log(hash);
console.log(hash.length);

const md5 = crypto.createHash("md5").update("test").digest("hex");
console.log(md5);

const b64 = crypto.createHash("sha256").update("hello").digest("base64");
console.log(b64);

import os from "os";

console.log(os.platform());
console.log(os.arch());
console.log(os.type());
console.log(os.homedir().length > 0);
console.log(os.hostname().length > 0);
console.log(os.uptime() > 0);
console.log(os.EOL === "\n");

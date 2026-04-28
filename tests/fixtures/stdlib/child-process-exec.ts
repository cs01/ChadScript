import { execSync } from "child_process";
const result = execSync("echo hello");
console.log(result.trim());

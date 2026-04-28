import { execSync } from "child_process";
const result = execSync("echo hello", { encoding: "utf-8" });
console.log(result.trim());

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getDtsContent(): string {
  return fs.readFileSync(path.join(__dirname, "../../../chadscript.d.ts"), "utf8");
}

function getSkillContent(): string {
  return fs.readFileSync(path.join(__dirname, "../../../lib/skill.md"), "utf8");
}

const TSCONFIG_CONTENT = `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ES2020",
    "lib": ["ES2020"],
    "noEmit": true,
    "skipLibCheck": true,
    "strict": true
  }
}
`;

const HELLO_CONTENT = `console.log("Hello from ChadScript!");
`;

export function runInit(): void {
  const skillDir = path.join(".claude", "skills", "chadscript");
  const files: Array<{ name: string; content: string }> = [
    { name: "chadscript.d.ts", content: getDtsContent() },
    { name: "tsconfig.json", content: TSCONFIG_CONTENT },
    { name: "hello.ts", content: HELLO_CONTENT },
    { name: path.join(skillDir, "SKILL.md"), content: getSkillContent() },
  ];

  for (const file of files) {
    if (fs.existsSync(file.name)) {
      console.log(`  skip ${file.name} (already exists)`);
    } else {
      const dir = path.dirname(file.name);
      if (dir !== "." && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(file.name, file.content);
      console.log(`  created ${file.name}`);
    }
  }

  console.log("");
  console.log("\x1b[32mReady!\x1b[0m");
  console.log("");
  console.log("  Try: chad run hello.ts");
}

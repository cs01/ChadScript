// @category: errors
// @args: fixtures/students.csv
// A validating importer that reports problems the way CLI tools do: messages to stderr, a
// summary to stdout, and a distinct exit code per failure class set through process.exitCode.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const EXIT_USAGE = 64;
const EXIT_NOINPUT = 66;
const EXIT_DATAERR = 65;

interface Problem {
  line: number;
  message: string;
}

function validateRow(fields: string[], line: number): Problem[] {
  const problems: Problem[] = [];
  if (fields.length !== 7)
    problems.push({ line, message: `expected 7 fields, got ${fields.length}` });
  const [id, name, grade, ...rest] = fields;
  if (!/^\d+$/.test(id ?? "")) problems.push({ line, message: `bad id "${id}"` });
  if (!name) problems.push({ line, message: "missing name" });
  if (!["9", "10", "11", "12"].includes(grade ?? ""))
    problems.push({ line, message: `bad grade "${grade}"` });
  rest.slice(0, 3).forEach((score, i) => {
    if (score === "") problems.push({ line, message: `missing score #${i + 1}` });
  });
  return problems;
}

function main(argv: string[]): void {
  const file = argv[0];
  if (file === undefined) {
    console.error("usage: exit-codes <file.csv>");
    process.exitCode = EXIT_USAGE;
    return;
  }
  if (!existsSync(file)) {
    console.error(`error: ${file}: no such file`);
    process.exitCode = EXIT_NOINPUT;
    return;
  }
  const lines = readFileSync(file, "utf8").trim().split("\n");
  const problems: Problem[] = [];
  let good = 0;
  lines.slice(1).forEach((l, i) => {
    const p = validateRow(l.split(","), i + 2);
    if (p.length === 0) good++;
    problems.push(...p);
  });
  for (const p of problems) console.error(`${file}:${p.line}: ${p.message}`);
  console.log(`${good} valid rows, ${problems.length} problem(s)`);
  writeFileSync("import-report.json", JSON.stringify({ file, good, problems }, null, 2));
  if (problems.length > 0) process.exitCode = EXIT_DATAERR;
}

main(process.argv.slice(2));
console.log("importer finished");

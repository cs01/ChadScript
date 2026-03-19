import { ArgumentParser } from "chadscript/argparse";

const parser = new ArgumentParser(
  "cql",
  "Run SQL queries on CSV files — powered by SQLite, blazing fast",
);
parser.addFlag("no-header", "N", "First row is data, not a header");
parser.addFlag("tab", "t", "Use tab as delimiter");
parser.addPositional("query", "SQL query (use c0, c1, c2... as column names, table is 'data')");
parser.addPositional("file", "CSV file to query (reads stdin if omitted)");
parser.parse(process.argv);

const query = parser.getPositional(0);
if (query.length === 0) {
  console.error("cql: missing SQL query");
  console.error("Example: cql \"SELECT * FROM data WHERE c2 > '30'\" users.csv");
  console.error("Columns are named c0, c1, c2, ... (up to c9). Always use SELECT *");
  console.error("Try 'cql --help' for more information");
  process.exit(2);
}

const filePath = parser.getPositional(1);
const useTab = parser.getFlag("tab");
const forceNoHeader = parser.getFlag("no-header");

let content = "";
if (filePath.length === 0) {
  content = process.stdin.read();
} else {
  content = fs.readFileSync(filePath);
}

if (content.trim().length === 0) {
  console.error("cql: empty input");
  process.exit(1);
}

const rawLines = content.split("\n");
const lines: string[] = [];
let li = 0;
while (li < rawLines.length) {
  if (rawLines[li].trim().length > 0) {
    lines.push(rawLines[li]);
  }
  li = li + 1;
}

if (lines.length === 0) {
  console.error("cql: no data rows");
  process.exit(1);
}

function splitLine(line: string): string[] {
  if (useTab) {
    return line.split("\t");
  }
  const fields: string[] = [];
  let current = "";
  let inQuote = false;
  let i = 0;
  while (i < line.length) {
    const ch = line.charAt(i);
    if (inQuote) {
      if (ch === '"' && i + 1 < line.length && line.charAt(i + 1) === '"') {
        current = current + '"';
        i = i + 2;
        continue;
      }
      if (ch === '"') {
        inQuote = false;
        i = i + 1;
        continue;
      }
      current = current + ch;
    } else {
      if (ch === '"') {
        inQuote = true;
        i = i + 1;
        continue;
      }
      if (ch === ",") {
        fields.push(current);
        current = "";
        i = i + 1;
        continue;
      }
      current = current + ch;
    }
    i = i + 1;
  }
  fields.push(current);
  return fields;
}

function looksLikeHeader(fields: string[]): boolean {
  let alphaCount = 0;
  let i = 0;
  while (i < fields.length) {
    const f = fields[i].trim();
    if (f.length > 0) {
      const first = f.charAt(0);
      if ((first >= "a" && first <= "z") || (first >= "A" && first <= "Z") || first === "_") {
        alphaCount = alphaCount + 1;
      }
    }
    i = i + 1;
  }
  return alphaCount === fields.length;
}

const firstFields = splitLine(lines[0]);
let hasHeader = true;
if (forceNoHeader) {
  hasHeader = false;
} else {
  hasHeader = looksLikeHeader(firstFields);
}

const headerNames: string[] = [];
if (hasHeader) {
  let hi = 0;
  while (hi < firstFields.length) {
    headerNames.push(firstFields[hi].trim());
    hi = hi + 1;
  }
}

let numCols = firstFields.length;
if (numCols > 10) numCols = 10;

interface Row {
  c0: string;
  c1: string;
  c2: string;
  c3: string;
  c4: string;
  c5: string;
  c6: string;
  c7: string;
  c8: string;
  c9: string;
}

const db = sqlite.open(":memory:");

let createSQL = "CREATE TABLE data (";
let ci = 0;
while (ci < numCols) {
  if (ci > 0) createSQL = createSQL + ", ";
  createSQL = createSQL + "c" + ci + " TEXT";
  ci = ci + 1;
}
createSQL = createSQL + ")";
sqlite.exec(db, createSQL);

let dataStart = 0;
if (hasHeader) dataStart = 1;

let row = dataStart;
while (row < lines.length) {
  const fields = splitLine(lines[row]);
  let insertSQL = "INSERT INTO data VALUES (";
  let vi = 0;
  while (vi < numCols) {
    if (vi > 0) insertSQL = insertSQL + ", ";
    let val = "";
    if (vi < fields.length) {
      val = fields[vi].trim();
    }
    let escaped = "";
    let ei = 0;
    while (ei < val.length) {
      if (val.charAt(ei) === "'") {
        escaped = escaped + "''";
      } else {
        escaped = escaped + val.charAt(ei);
      }
      ei = ei + 1;
    }
    insertSQL = insertSQL + "'" + escaped + "'";
    vi = vi + 1;
  }
  insertSQL = insertSQL + ")";
  sqlite.exec(db, insertSQL);
  row = row + 1;
}

if (hasHeader && headerNames.length > 0) {
  console.error("Column mapping:");
  let mi = 0;
  while (mi < headerNames.length && mi < numCols) {
    console.error("  c" + mi + " = " + headerNames[mi]);
    mi = mi + 1;
  }
  console.error("");
}

const results: Row[] = sqlite.query(db, query);

if (results.length === 0) {
  sqlite.close(db);
  process.exit(0);
}

function getCol(r: Row, idx: number): string {
  if (idx === 0) return r.c0;
  if (idx === 1) return r.c1;
  if (idx === 2) return r.c2;
  if (idx === 3) return r.c3;
  if (idx === 4) return r.c4;
  if (idx === 5) return r.c5;
  if (idx === 6) return r.c6;
  if (idx === 7) return r.c7;
  if (idx === 8) return r.c8;
  return r.c9;
}

function padRight(s: string, width: number): string {
  let result = s;
  while (result.length < width) {
    result = result + " ";
  }
  return result;
}

const colWidths: number[] = [];
let ki = 0;
while (ki < numCols) {
  let w = 2;
  if (hasHeader && ki < headerNames.length) {
    w = headerNames[ki].length;
  }
  colWidths.push(w);
  ki = ki + 1;
}

let i = 0;
while (i < results.length) {
  let ki2 = 0;
  while (ki2 < numCols) {
    const val = getCol(results[i], ki2);
    if (val.length > colWidths[ki2]) {
      colWidths[ki2] = val.length;
    }
    ki2 = ki2 + 1;
  }
  i = i + 1;
}

let headerLine = "";
let sepLine = "";
ki = 0;
while (ki < numCols) {
  if (ki > 0) {
    headerLine = headerLine + " | ";
    sepLine = sepLine + "-+-";
  }
  let colLabel = "c" + ki;
  if (hasHeader && ki < headerNames.length) {
    colLabel = headerNames[ki];
  }
  if (colLabel.length > colWidths[ki]) {
    colWidths[ki] = colLabel.length;
  }
  headerLine = headerLine + padRight(colLabel, colWidths[ki]);
  let dash = "";
  let di = 0;
  while (di < colWidths[ki]) {
    dash = dash + "-";
    di = di + 1;
  }
  sepLine = sepLine + dash;
  ki = ki + 1;
}
console.log(headerLine);
console.log(sepLine);

i = 0;
while (i < results.length) {
  let line = "";
  let ki3 = 0;
  while (ki3 < numCols) {
    if (ki3 > 0) line = line + " | ";
    line = line + padRight(getCol(results[i], ki3), colWidths[ki3]);
    ki3 = ki3 + 1;
  }
  console.log(line);
  i = i + 1;
}

sqlite.close(db);

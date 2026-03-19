import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const pattern = process.argv[2];
const target = process.argv[3];
let totalMatches = 0;

function searchFile(filePath) {
  const content = readFileSync(filePath, 'utf8');
  if (content.length === 0) return;
  const lines = content.split('\n');
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(pattern)) count++;
  }
  totalMatches += count;
}

function searchDir(dirPath) {
  const entries = readdirSync(dirPath);
  for (const entry of entries) {
    const full = join(dirPath, entry);
    const info = statSync(full);
    if (info.isFile()) searchFile(full);
    else if (info.isDirectory()) searchDir(full);
  }
}

searchDir(target);

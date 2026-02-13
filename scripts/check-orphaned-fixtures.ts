import * as fs from 'node:fs';
import * as path from 'node:path';

const FIXTURES_DIR = 'tests/fixtures';
const TEST_FILES = [
  'tests/test-fixtures.ts',
  'tests/compiler.test.ts',
  'tests/network.test.ts',
];
const ALLOWLIST = new Set([
  'tsconfig.json',
  'README.md',
  'imports-helper.js',
  'index.d.ts',
  'test-file.txt',
]);

function getAllFixtureFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllFixtureFiles(fullPath));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

function extractReferencedFixtures(): Set<string> {
  const refs = new Set<string>();
  for (const testFile of TEST_FILES) {
    if (!fs.existsSync(testFile)) continue;
    const content = fs.readFileSync(testFile, 'utf-8');
    const pattern = /tests\/fixtures\/[^\s'"`,)]+\.(ts|js)/g;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      refs.add(match[0]);
    }
  }
  return refs;
}

const allFixtures = getAllFixtureFiles(FIXTURES_DIR);
const referencedFixtures = extractReferencedFixtures();

const orphans: string[] = [];
for (const fixture of allFixtures) {
  const basename = path.basename(fixture);
  if (ALLOWLIST.has(basename)) continue;
  if (!referencedFixtures.has(fixture)) {
    orphans.push(fixture);
  }
}

if (orphans.length === 0) {
  console.log('No orphaned fixtures found.');
} else {
  console.log(`Found ${orphans.length} orphaned fixture(s):`);
  for (const orphan of orphans) {
    console.log(`  ${orphan}`);
  }
  process.exit(1);
}

import * as fs from 'fs';
import { getDtsContent } from './embedded-dts.js';

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
  const files: Array<{ name: string; content: string }> = [
    { name: 'chadscript.d.ts', content: getDtsContent() },
    { name: 'tsconfig.json', content: TSCONFIG_CONTENT },
    { name: 'hello.ts', content: HELLO_CONTENT },
  ];

  for (const file of files) {
    if (fs.existsSync(file.name)) {
      console.log(`  skip ${file.name} (already exists)`);
    } else {
      fs.writeFileSync(file.name, file.content);
      console.log(`  created ${file.name}`);
    }
  }

  console.log('');
  console.log('\x1b[32mReady!\x1b[0m');
  console.log('');
  console.log('  Try: chad run hello.ts');
}

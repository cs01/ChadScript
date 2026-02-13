import * as fs from 'fs';
import { getDtsContent } from './embedded-dts.js';

const TSCONFIG_CONTENT = `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ES2020",
    "lib": ["ES2020"],
    "noEmit": true,
    "skipLibCheck": true,
    "strict": false
  },
  "files": ["chadscript.d.ts"]
}
`;

const HELLO_CONTENT = `console.log("Hello from ChadScript!");
process.exit(0);
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
  console.log('ready! try: chad build hello.ts && .build/hello');
}

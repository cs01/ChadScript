import * as fs from 'fs';
import * as path from 'path';

function testBootstrapAPIs() {
  console.log("Testing Bootstrap APIs");

  // Test fs.writeFileSync
  fs.writeFileSync('/tmp/test-output.txt', 'Hello from ChadScript!');
  console.log("OK fs.writeFileSync");

  // Test fs.existsSync
  const exists = fs.existsSync('/tmp/test-output.txt');
  console.log("OK fs.existsSync");

  // Test fs.readFileSync
  const contents = fs.readFileSync('/tmp/test-output.txt', 'utf8');
  console.log(contents);
  console.log("OK fs.readFileSync");

  // Test path.resolve
  const resolved = path.resolve('/tmp/test-output.txt');
  console.log(resolved);
  console.log("OK path.resolve");

  // Test path.dirname
  const dir = path.dirname('/tmp/test-output.txt');
  console.log(dir);
  console.log("OK path.dirname");

  // Test JSON.stringify with number
  const numStr = JSON.stringify(42);
  console.log(numStr);
  console.log("OK JSON.stringify (number)");

  // Test JSON.stringify with string
  const strStr = JSON.stringify('hello');
  console.log(strStr);
  console.log("OK JSON.stringify (string)");

  // Test fs.unlinkSync
  fs.unlinkSync('/tmp/test-output.txt');
  console.log("OK fs.unlinkSync");

  console.log("All tests passed!");

  return 0;
}

process.exit(testBootstrapAPIs());

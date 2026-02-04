import { parseSource } from '../../../src/parser-native/index.js';
import { transformTree } from '../../../src/parser-native/transformer.js';

function testTransform(): void {
  const source = 'let x = 1;';
  console.log("Step 1: Parsing");
  
  const tree = parseSource(source);
  console.log("Step 2: Got tree");
  
  console.log("Step 3: Calling transformTree");
  const ast = transformTree(tree);
  console.log("Step 4: Got AST");
  
  console.log("TEST_PASSED");
}

testTransform();

import { parseSource, TreeSitterNode, TreeSitterTree } from '../../../src/parser-native/index.js';

function testParse(): void {
  const source = 'let x = 1;';
  console.log("Parsing");
  
  const tree = parseSource(source);
  console.log("Got tree");
  
  const root = tree.rootNode;
  console.log("Root: " + root.type);
  
  const count = root.namedChildCount;
  console.log("Count:");
  console.log(count);
  
  console.log("TEST_PASSED");
}

testParse();

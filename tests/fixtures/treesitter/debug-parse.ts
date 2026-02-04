import { parseSource, getNamedChild, TreeSitterNode } from '../../../src/parser-native/index.js';

function testParse(): void {
  const source = 'let x = 1;';
  console.log("Parsing source: " + source);
  
  const tree = parseSource(source);
  console.log("Got tree");
  
  const root = tree.rootNode;
  console.log("Root type: " + root.type);
  
  const count = root.namedChildCount;
  console.log("Named child count: ");
  console.log(count);
  
  const firstChild = getNamedChild(root, 0);
  if (firstChild) {
    console.log("First child type: " + firstChild.type);
  } else {
    console.log("No first child");
  }
  
  console.log("TEST_PASSED");
}

testParse();

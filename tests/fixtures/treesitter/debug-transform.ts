import { parseSource, getNamedChild, TreeSitterNode, TreeSitterTree } from '../../../src/parser-native/index.js';
import { transformTree } from '../../../src/parser-native/transformer.js';

function testTransform(): void {
  const source = 'let x = 1;';
  console.log("Step 1: Parsing source");
  
  const tree = parseSource(source);
  console.log("Step 2: Got tree");
  
  const root = tree.rootNode;
  console.log("Step 3: Got root, type: " + root.type);
  console.log("Step 4: Named child count: ");
  console.log(root.namedChildCount);
  
  console.log("Step 5: Getting first child");
  const firstChild = getNamedChild(root, 0);
  if (firstChild) {
    console.log("Step 6: First child type: " + firstChild.type);
  } else {
    console.log("Step 6: No first child");
  }
  
  console.log("Step 7: Calling transformTree");
  const ast = transformTree(tree);
  console.log("Step 8: Got AST");
  
  console.log("TEST_PASSED");
}

testTransform();

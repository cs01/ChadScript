import { parseSource, getNamedChild, TreeSitterNode, TreeSitterTree } from '../../../src/parser-native/index.js';

function transformProgram(node: TreeSitterNode): void {
  console.log("In transformProgram");
  console.log("Node type: " + node.type);
  
  const count = node.namedChildCount;
  console.log("Child count:");
  console.log(count);
  
  for (let i = 0; i < count; i = i + 1) {
    console.log("Getting child:");
    console.log(i);
    const child = getNamedChild(node, i);
    if (child) {
      console.log("Child type: " + child.type);
    } else {
      console.log("Null child");
    }
  }
  
  console.log("Done with transformProgram");
}

function testTransform(): void {
  const source = 'let x = 1;';
  console.log("Parsing");
  
  const tree = parseSource(source);
  console.log("Got tree");
  
  const root = tree.rootNode;
  console.log("Root: " + root.type);
  
  console.log("Calling transformProgram");
  transformProgram(root);
  
  console.log("TEST_PASSED");
}

testTransform();

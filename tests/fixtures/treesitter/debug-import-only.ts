import { parseSource, getNamedChild, TreeSitterNode, TreeSitterTree } from '../../../src/parser-native/index.js';
import { transformTree, AST } from '../../../src/parser-native/transformer.js';

function testImport(): void {
  console.log("Import successful");
  console.log("TEST_PASSED");
}

testImport();

interface FunctionInfo {
  name: string;
  params: string[];
}

interface AST {
  functions: FunctionInfo[];
}

function getAST(): AST {
  return {
    functions: [
      { name: "test", params: ["a", "b"] }
    ]
  };
}

const ast = getAST();
console.log(ast.functions.length);

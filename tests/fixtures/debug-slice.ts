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
const funcs = ast.functions.slice(0);
console.log(funcs.length);

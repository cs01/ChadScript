// @test-compile-error: named type assertion 'FunctionMeta' has wrong field indices

interface FunctionNode {
  name: string;
  params: string[];
  body: string;
  returnType: string;
  isAsync: boolean;
  isExported: boolean;
  parameters: string[];
}

interface FunctionMeta {
  name: string;
  returnType: string;
  parameters: string[];
}

function process(node: FunctionNode): string {
  const meta = node as FunctionMeta;
  return meta.name;
}

console.log(
  process({
    name: "foo",
    params: [],
    body: "",
    returnType: "void",
    isAsync: false,
    isExported: false,
    parameters: [],
  }),
);

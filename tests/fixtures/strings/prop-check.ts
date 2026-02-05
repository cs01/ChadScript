interface TestExpr {
  property: string;
}

function testProp(e: TestExpr): boolean {
  const prop = e.property;
  if (prop.length === 0) {
    return true;
  }
  return false;
}

const expr: TestExpr = { property: "hello" };
console.log(testProp(expr));

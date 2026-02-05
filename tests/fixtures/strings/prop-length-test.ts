interface TestExpr {
  property: string;
}

function testPropLength(expr: TestExpr): number {
  const prop = expr.property;
  if (prop.length === 0) {
    return 0;
  }
  return prop.length;
}

const e: TestExpr = { property: "hello" };
console.log(testPropLength(e));

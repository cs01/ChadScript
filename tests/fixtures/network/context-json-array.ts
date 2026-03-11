// @test-description: c.json() accepts object arrays (literal and variable)

import { Router, Context } from "chadscript/http";

function test(): void {
  const app = new Router();

  app.get("/literal", (c: Context) => {
    return c.json([{ name: "Alice", age: 30 }]);
  });

  app.get("/variable", (c: Context) => {
    const items = [{ name: "Alice", age: 30 }];
    return c.json(items);
  });

  const r1 = app.handle({
    method: "GET",
    path: "/literal",
    body: "",
    contentType: "",
    headers: "",
    bodyLen: 0,
  });
  if (r1.body !== '[{"name":"Alice","age":30}]') {
    console.log("FAIL literal: " + r1.body);
    process.exit(1);
  }

  const r2 = app.handle({
    method: "GET",
    path: "/variable",
    body: "",
    contentType: "",
    headers: "",
    bodyLen: 0,
  });
  if (r2.body !== '[{"name":"Alice","age":30}]') {
    console.log("FAIL variable: " + r2.body);
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
test();

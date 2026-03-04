// @test-description: c.json() accepts objects and auto-serializes them

import { Router, Context } from "chadscript/http";

function test(): void {
  const app = new Router();
  app.get("/obj", (c: Context) => {
    return c.json({ message: "hello" });
  });
  app.get("/str", (c: Context) => {
    return c.json('{"already":"json"}');
  });

  const r1 = app.handle({
    method: "GET",
    path: "/obj",
    body: "",
    contentType: "",
    headers: "",
    bodyLen: 0,
  });
  if (r1.body !== '{"message":"hello"}') {
    console.log("FAIL obj: " + r1.body);
    process.exit(1);
  }

  const r2 = app.handle({
    method: "GET",
    path: "/str",
    body: "",
    contentType: "",
    headers: "",
    bodyLen: 0,
  });
  if (r2.body !== '{"already":"json"}') {
    console.log("FAIL str: " + r2.body);
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
test();

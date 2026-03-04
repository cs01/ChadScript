// @test-description: Router accepts named top-level functions as route handlers

import { Router, Context } from "chadscript/http";

function getHello(c: Context): HttpResponse {
  return c.text("hello");
}

function getJson(c: Context): HttpResponse {
  return c.json('{"ok":true}');
}

function testRouter(): void {
  const app = new Router();
  app.get("/hello", getHello);
  app.get("/json", getJson);

  const r1 = app.handle({
    method: "GET",
    path: "/hello",
    body: "",
    contentType: "",
    headers: "",
    bodyLen: 0,
  });
  if (r1.body !== "hello") {
    console.log("FAIL hello: " + r1.body);
    process.exit(1);
  }

  const r2 = app.handle({
    method: "GET",
    path: "/json",
    body: "",
    contentType: "",
    headers: "",
    bodyLen: 0,
  });
  if (r2.body !== '{"ok":true}') {
    console.log("FAIL json: " + r2.body);
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testRouter();

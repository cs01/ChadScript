// @test-description: c.json() accepts objects and auto-serializes them
import { Router, Context } from "chadscript/router";

function testJsonMethod(): void {
  const app = new Router();

  app.get("/test", (c: Context) => {
    return c.json({ message: "hello" });
  });

  const resp = app.handle({
    method: "GET",
    path: "/test",
    body: "",
    contentType: "",
    headers: "",
    bodyLen: 0,
  });

  if (resp.body !== '{"message":"hello"}') {
    console.log("FAIL: body was: " + resp.body);
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testJsonMethod();

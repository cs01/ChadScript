// @test-description: Router param extraction and basic routing

import { Router, Context } from "chadscript/http";

function testRouter(): void {
  const app = new Router();

  app.get("/hello", (c: Context) => {
    return c.text("hello world");
  });

  app.get("/api/rooms/:id", (c: Context) => {
    const id = c.req.param("id");
    return c.json('{"id":"' + id + '"}');
  });

  app.post("/api/rooms", (c: Context) => {
    c.status(201);
    return c.text("Created");
  });

  app.get("/api/users/:name/posts/:pid", (c: Context) => {
    const name = c.req.param("name");
    const pid = c.req.param("pid");
    return c.text(name + "/" + pid);
  });

  const r1 = app.handle({
    method: "GET",
    path: "/hello",
    body: "",
    contentType: "",
    headers: "",
    bodyLen: 0,
  });
  if (r1.status !== 200) {
    console.log("FAIL: /hello status");
    process.exit(1);
  }
  if (r1.body !== "hello world") {
    console.log("FAIL: /hello body: " + r1.body);
    process.exit(1);
  }

  const r2 = app.handle({
    method: "GET",
    path: "/api/rooms/42",
    body: "",
    contentType: "",
    headers: "",
    bodyLen: 0,
  });
  if (r2.status !== 200) {
    console.log("FAIL: /api/rooms/:id status");
    process.exit(1);
  }
  if (r2.body !== '{"id":"42"}') {
    console.log("FAIL: /api/rooms/:id body: " + r2.body);
    process.exit(1);
  }

  const r3 = app.handle({
    method: "POST",
    path: "/api/rooms",
    body: "",
    contentType: "",
    headers: "",
    bodyLen: 0,
  });
  if (r3.status !== 201) {
    console.log("FAIL: POST /api/rooms status: " + r3.status);
    process.exit(1);
  }

  const r4 = app.handle({
    method: "GET",
    path: "/api/users/alice/posts/99",
    body: "",
    contentType: "",
    headers: "",
    bodyLen: 0,
  });
  if (r4.body !== "alice/99") {
    console.log("FAIL: multi-param body: " + r4.body);
    process.exit(1);
  }

  const r5 = app.handle({
    method: "GET",
    path: "/not-found",
    body: "",
    contentType: "",
    headers: "",
    bodyLen: 0,
  });
  if (r5.status !== 404) {
    console.log("FAIL: 404 status: " + r5.status);
    process.exit(1);
  }

  const r6 = app.handle({
    method: "DELETE",
    path: "/api/rooms/5",
    body: "",
    contentType: "",
    headers: "",
    bodyLen: 0,
  });
  if (r6.status !== 404) {
    console.log("FAIL: wrong method should 404: " + r6.status);
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testRouter();

import { ArgumentParser } from "chadscript/argparse";
import { Router, Context } from "chadscript/http";
import { httpServe, getHeader, parseQueryString } from "chadscript/http";

const parser = new ArgumentParser("http-server", "HTTP server with Router API");
parser.addOption("port", "p", "Port to listen on", "3000");
parser.parse(process.argv);

const port = parseInt(parser.getOption("port"));

const app: Router = new Router();

app.get("/", (c: Context) => {
  return c.html(
    "<!doctype html><html><head><style>" +
      "body{font-family:monospace;max-width:640px;margin:40px auto;padding:0 24px;background:#f9f9f9;color:#111}" +
      "h2{margin-bottom:24px}" +
      ".route{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #e5e5e5}" +
      ".method{font-weight:bold;min-width:36px}" +
      ".get{color:#0070f3}.post{color:#e67e00}" +
      "a{color:#0070f3;text-decoration:none}.a:hover{text-decoration:underline}" +
      ".desc{color:#888;font-size:12px;margin-left:auto}" +
      "input[type=text]{font-family:monospace;border:1px solid #ccc;border-radius:4px;padding:4px 8px;font-size:13px;width:180px}" +
      "button{font-family:monospace;background:#e67e00;color:#fff;border:none;border-radius:4px;padding:5px 10px;cursor:pointer;font-size:13px}" +
      "button:hover{background:#c96d00}" +
      "</style></head><body>" +
      "<h2>ChadScript HTTP Server</h2>" +
      "<div class='route'><span class='method get'>GET</span><a href='/json'>/json</a><span class='desc'>JSON response</span></div>" +
      "<div class='route'><span class='method get'>GET</span><a href='/api/users/42'>/api/users/42</a><span class='desc'>user by ID</span></div>" +
      "<div class='route'><span class='method get'>GET</span><a href='/api/users/alice/posts/7'>/api/users/alice/posts/7</a><span class='desc'>multi-param</span></div>" +
      "<div class='route'><span class='method get'>GET</span><a href='/status/418'>/status/418</a><span class='desc'>custom status code</span></div>" +
      "<div class='route'><span class='method get'>GET</span><a href='/headers'>/headers</a><span class='desc'>echo Authorization header</span></div>" +
      "<div class='route'><span class='method get'>GET</span><a href='/redirect'>/redirect</a><span class='desc'>302 redirect</span></div>" +
      "<div class='route'><span class='method post'>POST</span><span>/echo</span>" +
      "<form method='POST' action='/echo' style='display:flex;gap:8px;align-items:center'><input type='text' name='body' value='hello world'><button type='submit'>Send</button></form>" +
      "<span class='desc'>echo body</span></div>" +
      "<div class='route'><span class='method post'>POST</span><span>/api/users</span>" +
      "<form method='POST' action='/api/users' style='display:flex;gap:8px'><button type='submit'>Send</button></form>" +
      "<span class='desc'>201 created</span></div>" +
      "</body></html>",
  );
});

app.get("/json", (c: Context) => {
  return c.json({ message: "hello", count: 42 });
});

app.get("/api/users/:id", (c: Context) => {
  const id = c.req.param("id");
  return c.json({ id });
});

app.get("/api/users/:name/posts/:pid", (c: Context) => {
  const name = c.req.param("name");
  const pid = c.req.param("pid");
  return c.json({ user: name, post: pid });
});

app.get("/status/:code", (c: Context) => {
  const code = parseInt(c.req.param("code"));
  c.status(code);
  return c.text("Status " + c.req.param("code"));
});

app.get("/headers", (c: Context) => {
  const auth = getHeader(c.req.headers, "Authorization");
  return c.text("Authorization: " + auth);
});

app.get("/redirect", (c: Context) => {
  return c.redirect("/");
});

app.post("/echo", (c: Context) => {
  return c.text(c.req.body);
});

app.post("/api/users", (c: Context) => {
  c.status(201);
  return c.json({ created: true });
});

app.notFound((c: Context) => {
  c.status(404);
  return c.json({ error: "not found", path: c.req.path });
});

console.log("ChadScript HTTP Server (Router API)");
console.log("  listening on http://localhost:" + port);
console.log("");
console.log("Routes:");
console.log("  GET  /                        - server info");
console.log("  GET  /json                    - JSON response");
console.log("  GET  /api/users/:id           - user by ID");
console.log("  GET  /api/users/:name/posts/:pid - multi-param");
console.log("  GET  /status/:code            - custom status code");
console.log("  GET  /headers                 - echo Authorization header");
console.log("  GET  /redirect                - 302 → /");
console.log("  POST /echo                    - echo body");
console.log("  POST /api/users               - 201 created");
console.log("");
console.log("Try it:");
console.log("  curl http://localhost:" + port + "/api/users/42");
console.log("  curl http://localhost:" + port + "/api/users/alice/posts/7");
console.log("  curl -X POST -d 'hello' http://localhost:" + port + "/echo");
console.log("  curl -H 'Authorization: Bearer token' http://localhost:" + port + "/headers");
console.log("");

httpServe(port, (req: HttpRequest) => app.handle(req));

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
    "<html><body style='font-family:monospace;max-width:600px;margin:40px auto;padding:0 20px'>" +
      "<h2>ChadScript HTTP Server</h2>" +
      "<table style='border-collapse:collapse;width:100%'>" +
      "<tr><td><a href='/json'>GET /json</a></td><td style='color:#888;padding-left:16px'>JSON response</td></tr>" +
      "<tr><td><a href='/api/users/42'>GET /api/users/42</a></td><td style='color:#888;padding-left:16px'>user by ID</td></tr>" +
      "<tr><td><a href='/api/users/alice/posts/7'>GET /api/users/alice/posts/7</a></td><td style='color:#888;padding-left:16px'>multi-param</td></tr>" +
      "<tr><td><a href='/status/418'>GET /status/418</a></td><td style='color:#888;padding-left:16px'>custom status code</td></tr>" +
      "<tr><td><a href='/redirect'>GET /redirect</a></td><td style='color:#888;padding-left:16px'>302 redirect</td></tr>" +
      "<tr><td style='color:#aaa'>POST /echo</td><td style='color:#888;padding-left:16px'>echo body</td></tr>" +
      "<tr><td style='color:#aaa'>POST /api/users</td><td style='color:#888;padding-left:16px'>201 created</td></tr>" +
      "</table></body></html>",
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

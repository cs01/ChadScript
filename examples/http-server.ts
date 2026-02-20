// ChadScript HTTP Server Example
// Demonstrates Express-like routing with HttpRequest/HttpResponse interfaces

interface HttpRequest {
  method: string;
  path: string;
  body: string;
  contentType: string;
}

interface HttpResponse {
  status: number;
  body: string;
}

// --- Route Handlers ---

function homeHandler(req: HttpRequest): HttpResponse {
  const html =
    '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ChadScript</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0a0a0a;color:#e0e0e0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center}.container{text-align:center;max-width:760px;padding:2rem}h1{font-size:3.5rem;color:#fff;margin-bottom:.5rem;letter-spacing:-.02em}.subtitle{color:#999;font-size:1.15rem;margin-bottom:2.5rem;line-height:1.5}.subtitle em{color:#e8a525;font-style:normal}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:2.5rem}.stat{background:#161616;border:1px solid #2a2a2a;border-radius:10px;padding:1.25rem 1rem}.stat .value{font-size:1.75rem;font-weight:700;color:#fff;font-family:monospace}.stat .label{font-size:.75rem;color:#555;text-transform:uppercase;letter-spacing:.05em;margin-top:.35rem}.pipeline{background:#161616;border:1px solid #2a2a2a;border-radius:10px;padding:1.25rem 1.5rem;margin-bottom:1.5rem;font-family:monospace;font-size:.85rem;color:#888;letter-spacing:.02em}.pipeline .arrow{color:#bbb}.pipeline .stage{color:#ccc}.features{display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-bottom:1.5rem;text-align:left}.feature{background:#161616;border:1px solid #2a2a2a;border-radius:8px;padding:.75rem 1rem;font-size:.8rem;color:#999}.feature b{color:#ccc;font-weight:600}footer{color:#444;font-size:.8rem;margin-top:1rem}footer a{color:#888;text-decoration:none}@media(max-width:600px){.stats{grid-template-columns:repeat(2,1fr)}.features{grid-template-columns:1fr}}</style></head><body><div class="container"><h1>ChadScript</h1><p class="subtitle">This page is served by a <em>native ELF binary</em> compiled from TypeScript. No runtime.</p><div class="stats"><div class="stat"><div class="value">&lt;8ms</div><div class="label">startup</div></div><div class="stat"><div class="value">0</div><div class="label">dependencies</div></div><div class="stat"><div class="value">312K</div><div class="label">binary size</div></div><div class="stat"><div class="value">ELF</div><div class="label">output format</div></div></div><div class="pipeline"><span class="stage">.ts</span> <span class="arrow">&rarr;</span> <span class="stage">AST</span> <span class="arrow">&rarr;</span> <span class="stage">LLVM IR</span> <span class="arrow">&rarr;</span> <span class="stage">.o</span> <span class="arrow">&rarr;</span> <span class="stage">native binary</span></div><div class="features"><div class="feature"><b>HTTP server</b> &mdash; built in, powered by libwebsockets</div><div class="feature"><b>fetch()</b> &mdash; HTTP client via libcurl</div><div class="feature"><b>async/await</b> &mdash; event loop via libuv</div><div class="feature"><b>JSON</b> &mdash; parse and stringify via cJSON</div><div class="feature"><b>File I/O</b> &mdash; fs.readFileSync, writeFileSync</div><div class="feature"><b>Self-hosting</b> &mdash; compiles its own source code</div></div><footer><a href="https://github.com/cs01/ChadScript">github.com/cs01/ChadScript</a></footer></div></body></html>';
  return { status: 200, body: html };
}

function jsonHandler(req: HttpRequest): HttpResponse {
  return { status: 200, body: '{"message":"hello","count":42}' };
}

function echoHandler(req: HttpRequest): HttpResponse {
  return { status: 200, body: req.body };
}

function echoQueryHandler(req: HttpRequest): HttpResponse {
  return { status: 200, body: req.path.substring(10, req.path.length) };
}

function statusHandler(req: HttpRequest): HttpResponse {
  const code = req.path.substring(8, req.path.length);
  return { status: 200, body: "Status " + code };
}

function contentTypeHandler(req: HttpRequest): HttpResponse {
  return { status: 200, body: "Content-Type: " + req.contentType };
}

function errorHandler(req: HttpRequest): HttpResponse {
  return { status: 500, body: "Internal Server Error" };
}

function createdHandler(req: HttpRequest): HttpResponse {
  return { status: 201, body: "Resource Created" };
}

function notFoundHandler(req: HttpRequest): HttpResponse {
  return { status: 404, body: "Not Found" };
}

// --- Router ---

function handleRequest(req: HttpRequest): HttpResponse {
  console.log(req.method + " " + req.path);

  // GET routes
  if (req.method == "GET") {
    if (req.path == "/") return homeHandler(req);
    if (req.path == "/json") return jsonHandler(req);
    if (req.path.startsWith("/echo?msg=")) return echoQueryHandler(req);
    if (req.path.startsWith("/status/")) return statusHandler(req);
    if (req.path == "/content-type") return contentTypeHandler(req);
    if (req.path == "/error") return errorHandler(req);
    if (req.path == "/created") return createdHandler(req);
  }

  // POST routes
  if (req.method == "POST") {
    if (req.path == "/echo") return echoHandler(req);
  }

  return notFoundHandler(req);
}

// --- Start Server ---

const port = 3000;
console.log("ChadScript HTTP Server starting on port " + port);
console.log("");
console.log("Available routes:");
console.log("  GET  /              - Home page");
console.log("  GET  /json          - JSON response");
console.log("  GET  /echo?msg=...  - Echo query parameter");
console.log("  GET  /status/:code  - Status code demo");
console.log("  GET  /content-type  - Show request content type");
console.log("  GET  /error         - 500 error response");
console.log("  GET  /created       - 201 created response");
console.log("  POST /echo          - Echo request body");
console.log("");
console.log("Try it out:");
console.log("  curl http://localhost:" + port + "/");
console.log("  curl http://localhost:" + port + "/json");
console.log("  curl http://localhost:" + port + "/echo?msg=hello");
console.log("  curl http://localhost:" + port + "/status/418");
console.log("  curl http://localhost:" + port + "/content-type");
console.log("  curl http://localhost:" + port + "/error");
console.log("  curl http://localhost:" + port + "/created");
console.log("  curl -X POST -d 'hello world' http://localhost:" + port + "/echo");
console.log("");
httpServe(port, handleRequest);

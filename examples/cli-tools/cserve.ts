import { ArgumentParser } from "chadscript/argparse";
import { Router, Context } from "chadscript/http";
import { httpServe, getHeader } from "chadscript/http";

const parser = new ArgumentParser(
  "cserve",
  "Static file server — like python -m http.server, but blazing fast",
);
parser.addOption("port", "p", "Port to listen on", "8080");
parser.addFlag("cors", "c", "Enable CORS headers");
parser.addFlag("quiet", "q", "Suppress request logging");
parser.addFlag("no-index", "I", "Disable automatic index.html serving");
parser.addPositional("dir", "Directory to serve (default: .)");
parser.parse(process.argv);

const port = parseInt(parser.getOption("port"));
const enableCors = parser.getFlag("cors");
const quiet = parser.getFlag("quiet");
const noIndex = parser.getFlag("no-index");

let rootDir = parser.getPositional(0);
if (rootDir.length === 0) {
  rootDir = ".";
}

function getMimeType(path: string): string {
  if (path.endsWith(".html") || path.endsWith(".htm")) return "text/html";
  if (path.endsWith(".css")) return "text/css";
  if (path.endsWith(".js")) return "application/javascript";
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".gif")) return "image/gif";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".ico")) return "image/x-icon";
  if (path.endsWith(".txt")) return "text/plain";
  if (path.endsWith(".xml")) return "application/xml";
  if (path.endsWith(".pdf")) return "application/pdf";
  if (path.endsWith(".woff")) return "font/woff";
  if (path.endsWith(".woff2")) return "font/woff2";
  if (path.endsWith(".ttf")) return "font/ttf";
  if (path.endsWith(".wasm")) return "application/wasm";
  if (path.endsWith(".ts")) return "text/plain";
  if (path.endsWith(".md")) return "text/plain";
  if (path.endsWith(".yaml") || path.endsWith(".yml")) return "text/plain";
  return "application/octet-stream";
}

function formatSize(size: number): string {
  if (size < 1024) return "" + size + "B";
  if (size < 1048576) return "" + Math.floor(size / 1024) + "K";
  return "" + Math.floor(size / 1048576) + "M";
}

function generateDirListing(dirPath: string, urlPath: string): string {
  const entries = fs.readdirSync(dirPath);
  let html = "<!DOCTYPE html><html><head><title>Index of " + urlPath + "</title>";
  html =
    html + "<style>body{font-family:monospace;margin:2em}a{text-decoration:none;color:#0366d6}";
  html = html + "a:hover{text-decoration:underline}table{border-collapse:collapse}";
  html = html + "td{padding:4px 16px}tr:hover{background:#f6f8fa}</style></head>";
  html = html + "<body><h2>Index of " + urlPath + "</h2><table>";

  if (urlPath !== "/") {
    html = html + '<tr><td><a href="../">..</a></td><td></td><td></td></tr>';
  }

  let i = 0;
  while (i < entries.length) {
    const name = entries[i];
    if (name.charAt(0) !== ".") {
      const entryPath = dirPath + "/" + name;
      const info = fs.statSync(entryPath);
      if (info.isDirectory()) {
        html = html + '<tr><td><a href="' + name + '/">' + name + "/</a></td><td>-</td></tr>";
      } else {
        html =
          html +
          '<tr><td><a href="' +
          name +
          '">' +
          name +
          "</a></td><td>" +
          formatSize(info.size) +
          "</td></tr>";
      }
    }
    i = i + 1;
  }

  html = html + "</table></body></html>";
  return html;
}

const app: Router = new Router();

app.get("/*", (c: Context) => {
  let reqPath = c.req.path;
  if (reqPath === "/") reqPath = "";

  let filePath = rootDir + reqPath;

  const info = fs.statSync(filePath);
  if (info.isDirectory()) {
    if (!noIndex) {
      const indexPath = filePath + "/index.html";
      const indexInfo = fs.statSync(indexPath);
      if (indexInfo.isFile()) {
        const indexContent = fs.readFileSync(indexPath);
        if (!quiet) {
          console.log("200 GET " + c.req.path + " -> index.html");
        }
        if (enableCors) c.header("Access-Control-Allow-Origin", "*");
        c.header("Content-Type", "text/html");
        return c.text(indexContent);
      }
    }
    const listing = generateDirListing(filePath, c.req.path);
    if (!quiet) {
      console.log("200 GET " + c.req.path + " (directory listing)");
    }
    if (enableCors) c.header("Access-Control-Allow-Origin", "*");
    return c.html(listing);
  }

  if (!info.isFile()) {
    if (!quiet) {
      console.log("404 GET " + c.req.path);
    }
    c.status(404);
    return c.text("404 Not Found");
  }

  const content = fs.readFileSync(filePath);
  const mime = getMimeType(filePath);

  if (!quiet) {
    console.log("200 GET " + c.req.path + " (" + formatSize(content.length) + ")");
  }

  if (enableCors) c.header("Access-Control-Allow-Origin", "*");
  c.header("Content-Type", mime);
  return c.text(content);
});

app.notFound((c: Context) => {
  if (!quiet) {
    console.log("404 " + c.req.method + " " + c.req.path);
  }
  c.status(404);
  return c.text("404 Not Found");
});

console.log("cserve - static file server");
console.log("  serving " + rootDir + " on http://localhost:" + port);
if (enableCors) console.log("  CORS enabled");
console.log("");

httpServe(port, (req: HttpRequest) => app.handle(req));

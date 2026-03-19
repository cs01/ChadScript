import { ArgumentParser } from "chadscript/argparse";

const parser = new ArgumentParser("chttp", "HTTP client — like curl, but blazing fast");
parser.addFlag("verbose", "v", "Show response status and info");
parser.addFlag("head", "I", "Show only response headers");
parser.addFlag("silent", "s", "Silent mode, no progress or errors");
parser.addFlag("no-color", "C", "Disable colorized output");
parser.addOption("method", "X", "HTTP method (GET, POST, PUT, DELETE)", "GET");
parser.addOption("header", "H", "Add a request header (Key: Value)", "");
parser.addOption("data", "d", "Request body data", "");
parser.addOption("output", "o", "Write response body to file", "");
parser.addPositional("url", "URL to request");
parser.parse(process.argv);

const url = parser.getPositional(0);
if (url.length === 0) {
  console.error("chttp: missing URL");
  console.error("Try 'chttp --help' for more information");
  process.exit(2);
}

const verbose = parser.getFlag("verbose");
const headOnly = parser.getFlag("head");
const silent = parser.getFlag("silent");
const noColor = parser.getFlag("no-color");
let method = parser.getOption("method");
const headerStr = parser.getOption("header");
const bodyData = parser.getOption("data");
const outputFile = parser.getOption("output");

if (bodyData.length > 0 && method === "GET") {
  method = "POST";
}

const colorCyan = "\x1b[36m";
const colorGreen = "\x1b[32m";
const colorYellow = "\x1b[33m";
const colorMagenta = "\x1b[35m";
const colorReset = "\x1b[0m";
const colorBold = "\x1b[1m";

function colorStatus(status: number): string {
  if (noColor) return "" + status;
  if (status < 300) return colorGreen + status + colorReset;
  if (status < 400) return colorYellow + status + colorReset;
  return "\x1b[31m" + status + colorReset;
}

function printHeader(key: string, val: string): void {
  if (val.length === 0) return;
  if (noColor) {
    console.log(key + ": " + val);
  } else {
    console.log(colorCyan + key + colorReset + ": " + val);
  }
}

async function run(): Promise<string> {
  const options: RequestInit = { method };

  if (bodyData.length > 0) {
    options.body = bodyData;
  }

  if (headerStr.length > 0) {
    const colonIdx = headerStr.indexOf(":");
    if (colonIdx !== -1) {
      const hKey = headerStr.substring(0, colonIdx).trim();
      const hVal = headerStr.substring(colonIdx + 1, headerStr.length).trim();
      const headers: Record<string, string> = {};
      headers[hKey] = hVal;
      options.headers = headers;
    }
  }

  const response = await fetch(url, options);
  const status = response.status;
  const body = response.text();

  if (verbose || headOnly) {
    if (noColor) {
      console.log(method + " " + url + " " + status);
    } else {
      console.log(
        colorBold +
          method +
          colorReset +
          " " +
          colorMagenta +
          url +
          colorReset +
          " " +
          colorStatus(status),
      );
    }

    const contentType = response.headers.get("content-type");
    printHeader("Content-Type", contentType);
    const contentLength = response.headers.get("content-length");
    printHeader("Content-Length", contentLength);

    if (headOnly) return "done";
    console.log("");
  }

  if (outputFile.length > 0) {
    fs.writeFileSync(outputFile, body);
    if (!silent) {
      console.error("chttp: saved " + body.length + " bytes to " + outputFile);
    }
    return "done";
  }

  console.log(body);
  return "done";
}

run();

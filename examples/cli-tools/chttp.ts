import { ArgumentParser } from "chadscript/argparse";

const parser = new ArgumentParser(
  "chttp",
  "HTTP client with colors and JSON formatting — like HTTPie, but blazing fast",
);
parser.addFlag("verbose", "v", "Show request and response headers");
parser.addFlag("head", "I", "Show only response headers");
parser.addFlag("silent", "s", "Silent mode, no progress or errors");
parser.addFlag("no-color", "C", "Disable colorized output");
parser.addFlag("raw", "r", "Raw output, no JSON formatting");
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
const isTty = tty.isatty(1);
const noColor = parser.getFlag("no-color") || !isTty;
const rawOutput = parser.getFlag("raw");
let method = parser.getOption("method");
const headerStr = parser.getOption("header");
const bodyData = parser.getOption("data");
const outputFile = parser.getOption("output");

if (bodyData.length > 0 && method === "GET") {
  method = "POST";
}

const cReset = "\x1b[0m";
const cBold = "\x1b[1m";
const cDim = "\x1b[2m";
const cRed = "\x1b[31m";
const cGreen = "\x1b[32m";
const cYellow = "\x1b[33m";
const cBlue = "\x1b[34m";
const cMagenta = "\x1b[35m";
const cCyan = "\x1b[36m";
const cWhite = "\x1b[37m";
const cGray = "\x1b[90m";

function colorStatus(status: number): string {
  if (noColor) return "" + status;
  if (status < 300) return cBold + cGreen + status + cReset;
  if (status < 400) return cBold + cYellow + status + cReset;
  return cBold + cRed + status + cReset;
}

function statusText(status: number): string {
  if (status === 200) return "OK";
  if (status === 201) return "Created";
  if (status === 204) return "No Content";
  if (status === 301) return "Moved Permanently";
  if (status === 302) return "Found";
  if (status === 304) return "Not Modified";
  if (status === 400) return "Bad Request";
  if (status === 401) return "Unauthorized";
  if (status === 403) return "Forbidden";
  if (status === 404) return "Not Found";
  if (status === 405) return "Method Not Allowed";
  if (status === 500) return "Internal Server Error";
  if (status === 502) return "Bad Gateway";
  if (status === 503) return "Service Unavailable";
  return "";
}

function printHeader(key: string, val: string): void {
  if (val.length === 0) return;
  if (noColor) {
    console.log(key + ": " + val);
  } else {
    console.log(cCyan + key + cReset + cDim + ": " + cReset + val);
  }
}

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\n" || ch === "\r" || ch === "\t";
}

function prettyJson(input: string): string {
  let result = "";
  let pos = 0;
  let indent = 0;
  let inString = false;
  let inKey = false;

  while (pos < input.length) {
    const ch = input.charAt(pos);

    if (inString) {
      if (ch === "\\") {
        if (noColor) {
          result = result + ch + input.charAt(pos + 1);
        } else {
          result = result + cYellow + ch + input.charAt(pos + 1) + cReset;
          if (inKey) result = result + cBlue;
          if (!inKey) result = result + cGreen;
        }
        pos = pos + 2;
        continue;
      }
      if (ch === '"') {
        if (noColor) {
          result = result + '"';
        } else {
          if (inKey) {
            result = result + cReset + '"';
          } else {
            result = result + cReset + '"';
          }
        }
        inString = false;
        inKey = false;
        pos = pos + 1;
        continue;
      }
      result = result + ch;
      pos = pos + 1;
      continue;
    }

    if (ch === '"') {
      let afterColon = false;
      let ri = result.length - 1;
      while (ri >= 0) {
        const rc = result.charAt(ri);
        if (isWhitespace(rc)) {
          ri = ri - 1;
          continue;
        }
        if (rc === ":" || rc === "m") {
          afterColon = true;
        }
        break;
      }

      let lookBack = pos - 1;
      while (lookBack >= 0 && isWhitespace(input.charAt(lookBack))) {
        lookBack = lookBack - 1;
      }
      if (lookBack >= 0) {
        const prev = input.charAt(lookBack);
        if (prev === ":" || prev === "," || prev === "[") {
          afterColon = true;
        }
        if (prev === "{" || prev === ",") {
          afterColon = false;
        }
      }
      if (lookBack < 0) {
        afterColon = false;
      }

      let isKeyStr = !afterColon;
      let peekAhead = pos + 1;
      let strEnd = peekAhead;
      while (strEnd < input.length) {
        if (input.charAt(strEnd) === "\\") {
          strEnd = strEnd + 2;
          continue;
        }
        if (input.charAt(strEnd) === '"') break;
        strEnd = strEnd + 1;
      }
      let afterStr = strEnd + 1;
      while (afterStr < input.length && isWhitespace(input.charAt(afterStr))) {
        afterStr = afterStr + 1;
      }
      if (afterStr < input.length && input.charAt(afterStr) === ":") {
        isKeyStr = true;
      }

      inString = true;
      inKey = isKeyStr;
      if (noColor) {
        result = result + '"';
      } else {
        if (isKeyStr) {
          result = result + '"' + cBlue;
        } else {
          result = result + '"' + cGreen;
        }
      }
      pos = pos + 1;
      continue;
    }

    if (ch === "{" || ch === "[") {
      if (noColor) {
        result = result + ch + "\n";
      } else {
        result = result + cWhite + ch + cReset + "\n";
      }
      indent = indent + 1;
      let sp = 0;
      while (sp < indent * 2) {
        result = result + " ";
        sp = sp + 1;
      }
      pos = pos + 1;
      continue;
    }

    if (ch === "}" || ch === "]") {
      indent = indent - 1;
      result = result + "\n";
      let sp = 0;
      while (sp < indent * 2) {
        result = result + " ";
        sp = sp + 1;
      }
      if (noColor) {
        result = result + ch;
      } else {
        result = result + cWhite + ch + cReset;
      }
      pos = pos + 1;
      continue;
    }

    if (ch === ",") {
      if (noColor) {
        result = result + ",\n";
      } else {
        result = result + cWhite + "," + cReset + "\n";
      }
      let sp = 0;
      while (sp < indent * 2) {
        result = result + " ";
        sp = sp + 1;
      }
      pos = pos + 1;
      continue;
    }

    if (ch === ":") {
      if (noColor) {
        result = result + ": ";
      } else {
        result = result + cDim + ": " + cReset;
      }
      pos = pos + 1;
      continue;
    }

    if (isWhitespace(ch)) {
      pos = pos + 1;
      continue;
    }

    if (ch === "t" || ch === "f" || ch === "n") {
      let end = pos;
      while (
        end < input.length &&
        !isWhitespace(input.charAt(end)) &&
        input.charAt(end) !== "," &&
        input.charAt(end) !== "}" &&
        input.charAt(end) !== "]"
      ) {
        end = end + 1;
      }
      const word = input.substring(pos, end);
      if (noColor) {
        result = result + word;
      } else {
        if (word === "null") {
          result = result + cDim + word + cReset;
        } else {
          result = result + cYellow + word + cReset;
        }
      }
      pos = end;
      continue;
    }

    if ((ch >= "0" && ch <= "9") || ch === "-") {
      let end = pos;
      while (
        end < input.length &&
        ((input.charAt(end) >= "0" && input.charAt(end) <= "9") ||
          input.charAt(end) === "." ||
          input.charAt(end) === "-" ||
          input.charAt(end) === "e" ||
          input.charAt(end) === "E" ||
          input.charAt(end) === "+")
      ) {
        end = end + 1;
      }
      const num = input.substring(pos, end);
      if (noColor) {
        result = result + num;
      } else {
        result = result + cMagenta + num + cReset;
      }
      pos = end;
      continue;
    }

    result = result + ch;
    pos = pos + 1;
  }

  return result;
}

function looksLikeJson(s: string): boolean {
  let i = 0;
  while (i < s.length && isWhitespace(s.charAt(i))) {
    i = i + 1;
  }
  if (i >= s.length) return false;
  return s.charAt(i) === "{" || s.charAt(i) === "[";
}

async function run(): Promise<string> {
  if (verbose) {
    if (noColor) {
      console.log(method + " " + url);
    } else {
      console.log(cBold + cGreen + method + cReset + " " + cMagenta + url + cReset);
    }
    if (headerStr.length > 0) {
      const colonIdx = headerStr.indexOf(":");
      if (colonIdx !== -1) {
        printHeader(
          headerStr.substring(0, colonIdx).trim(),
          headerStr.substring(colonIdx + 1, headerStr.length).trim(),
        );
      }
    }
    if (bodyData.length > 0) {
      printHeader("Content-Length", "" + bodyData.length);
    }
    console.log("");
  }

  const response = await fetch(url, { method, body: bodyData });
  const status = response.status;
  const body = response.text();

  if (isTty || verbose) {
    const sText = statusText(status);
    if (noColor) {
      console.log("HTTP " + status + " " + sText);
    } else {
      console.log(cDim + "HTTP" + cReset + " " + colorStatus(status) + " " + cDim + sText + cReset);
    }
    console.log("");
  }

  if (outputFile.length > 0) {
    fs.writeFileSync(outputFile, body);
    if (!silent) {
      console.error("chttp: saved " + body.length + " bytes to " + outputFile);
    }
    return "done";
  }

  if (!rawOutput && isTty && looksLikeJson(body)) {
    console.log(prettyJson(body));
  } else {
    console.log(body);
  }
  return "done";
}

run();

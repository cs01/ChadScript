import { ArgumentParser } from "chadscript/argparse";

const parser = new ArgumentParser("chttp", "HTTP client — like curl, but blazing fast");
parser.addFlag("verbose", "v", "Show response status and info");
parser.addFlag("silent", "s", "Silent mode, no progress or errors");
parser.addFlag("no-color", "C", "Disable colorized output");
parser.addOption("output", "o", "Write response body to file", "");
parser.addPositional("url", "URL to fetch (GET)");
parser.parse(process.argv);

const url = parser.getPositional(0);
if (url.length === 0) {
  console.error("chttp: missing URL");
  console.error("Try 'chttp --help' for more information");
  process.exit(2);
}

const verbose = parser.getFlag("verbose");
const silent = parser.getFlag("silent");
const noColor = parser.getFlag("no-color");
const outputFile = parser.getOption("output");

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

async function run(): Promise<string> {
  const response = await fetch(url);
  const status = response.status;
  const body = response.text();

  if (verbose) {
    if (noColor) {
      console.log("GET " + url + " " + status);
    } else {
      console.log(
        colorBold +
          "GET" +
          colorReset +
          " " +
          colorMagenta +
          url +
          colorReset +
          " " +
          colorStatus(status),
      );
    }
    console.log("Body length: " + body.length + " bytes");
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

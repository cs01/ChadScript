import { ArgumentParser } from "chadscript/argparse";

const parser = new ArgumentParser("chex", "Hex dump viewer — like xxd, but blazing fast");
parser.addOption("length", "n", "Number of bytes to display", "0");
parser.addOption("skip", "s", "Skip N bytes from the start", "0");
parser.addFlag("no-color", "C", "Disable colorized output");
parser.addFlag("plain", "p", "No ASCII column, just hex");
parser.addPositional("file", "File to dump (reads stdin if omitted)");
parser.parse(process.argv);

const filePath = parser.getPositional(0);
const noColor = parser.getFlag("no-color");
const plainMode = parser.getFlag("plain");
const cols = 16;

let maxLength = 0;
const maxLenStr = parser.getOption("length");
if (maxLenStr !== "0") {
  maxLength = parseInt(maxLenStr);
}

let skipBytes = 0;
const skipStr = parser.getOption("skip");
if (skipStr !== "0") {
  skipBytes = parseInt(skipStr);
}

const colorGray = "\x1b[90m";
const colorYellow = "\x1b[33m";
const colorGreen = "\x1b[32m";
const colorCyan = "\x1b[36m";
const colorReset = "\x1b[0m";

const bytes: Uint8Array = fs.readFileSync(filePath);

const hexChars = "0123456789abcdef";

function byteToHex(b: number): string {
  const hi = hexChars.charAt(Math.floor(b / 16));
  const lo = hexChars.charAt(Math.floor(b % 16));
  return hi + lo;
}

function offsetToHex(n: number): string {
  let result = "";
  let val = n;
  let i = 0;
  while (i < 8) {
    result = hexChars.charAt(Math.floor(val % 16)) + result;
    val = Math.floor(val / 16);
    i = i + 1;
  }
  return result;
}

function isPrintable(b: number): boolean {
  return b >= 32 && b < 127;
}

let start = skipBytes;
let end = bytes.length;
if (maxLength > 0 && start + maxLength < end) {
  end = start + maxLength;
}

let offset = start;
while (offset < end) {
  let hexPart = "";
  let asciiPart = "";
  let col = 0;

  while (col < cols && offset + col < end) {
    const b = bytes[offset + col];
    const hex = byteToHex(b);

    if (noColor) {
      hexPart = hexPart + hex + " ";
    } else {
      if (b === 0) {
        hexPart = hexPart + colorGray + hex + colorReset + " ";
      } else if (isPrintable(b)) {
        hexPart = hexPart + colorGreen + hex + colorReset + " ";
      } else {
        hexPart = hexPart + colorYellow + hex + colorReset + " ";
      }
    }

    if (col === 7) {
      hexPart = hexPart + " ";
    }

    if (!plainMode) {
      if (isPrintable(b)) {
        const code = b;
        let ch = "";
        if (code >= 32 && code < 127) {
          ch = String.fromCharCode(code);
        } else {
          ch = ".";
        }
        if (noColor) {
          asciiPart = asciiPart + ch;
        } else {
          asciiPart = asciiPart + colorGreen + ch + colorReset;
        }
      } else {
        if (noColor) {
          asciiPart = asciiPart + ".";
        } else {
          asciiPart = asciiPart + colorGray + "." + colorReset;
        }
      }
    }

    col = col + 1;
  }

  while (col < cols) {
    hexPart = hexPart + "   ";
    if (col === 7) {
      hexPart = hexPart + " ";
    }
    col = col + 1;
  }

  let line = "";
  if (noColor) {
    line = offsetToHex(offset) + ": " + hexPart;
  } else {
    line = colorCyan + offsetToHex(offset) + colorReset + ": " + hexPart;
  }

  if (!plainMode) {
    line = line + " |" + asciiPart + "|";
  }

  console.log(line);
  offset = offset + cols;
}

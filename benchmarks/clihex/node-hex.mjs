import { readFileSync } from "fs";

const filePath = process.argv[2];
const bytes = readFileSync(filePath);
const cols = 16;
const hexChars = "0123456789abcdef";

function byteToHex(b) {
  return hexChars[b >> 4] + hexChars[b & 0xf];
}

function offsetToHex(n) {
  let result = "";
  let val = n;
  for (let i = 0; i < 8; i++) {
    result = hexChars[val & 0xf] + result;
    val >>= 4;
  }
  return result;
}

let offset = 0;
const end = bytes.length;
const lines = [];

while (offset < end) {
  let hexPart = "";
  let asciiPart = "";
  let col = 0;

  while (col < cols && offset + col < end) {
    const b = bytes[offset + col];
    hexPart += byteToHex(b) + " ";
    if (col === 7) hexPart += " ";
    asciiPart += b >= 32 && b < 127 ? String.fromCharCode(b) : ".";
    col++;
  }

  while (col < cols) {
    hexPart += "   ";
    if (col === 7) hexPart += " ";
    col++;
  }

  lines.push(offsetToHex(offset) + ": " + hexPart + " |" + asciiPart + "|");
  offset += cols;
}

process.stdout.write(lines.join("\n") + "\n");

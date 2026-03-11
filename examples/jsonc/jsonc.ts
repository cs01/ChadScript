import { ArgumentParser } from "chadscript/argparse";

class JsoncParser {
  input: string;
  pos: number;
  len: number;
  pretty: boolean;
  depth: number;

  constructor(input: string, pretty: boolean) {
    this.input = input;
    this.pos = 0;
    this.len = input.length;
    this.pretty = pretty;
    this.depth = 0;
  }

  parse(): string {
    this.skipWhitespace();
    const parseResult = this.parseValue();
    this.skipWhitespace();
    if (this.pos < this.len) {
      return this.error("unexpected characters after value");
    }
    return parseResult;
  }

  parseValue(): string {
    this.skipWhitespace();
    if (this.pos >= this.len) {
      return this.error("unexpected end of input");
    }
    const ch = this.input.charAt(this.pos);
    if (ch === '"') {
      return this.parseString();
    }
    if (ch === "{") {
      return this.parseObject();
    }
    if (ch === "[") {
      return this.parseArray();
    }
    if (
      ch === "-" ||
      ch === "0" ||
      ch === "1" ||
      ch === "2" ||
      ch === "3" ||
      ch === "4" ||
      ch === "5" ||
      ch === "6" ||
      ch === "7" ||
      ch === "8" ||
      ch === "9"
    ) {
      return this.parseNumber();
    }
    if (ch === "t" || ch === "f" || ch === "n") {
      return this.parseLiteral();
    }
    return this.error("unexpected character: " + ch);
  }

  parseString(): string {
    let str = '"';
    this.pos = this.pos + 1;
    while (this.pos < this.len) {
      const sCh = this.input.charAt(this.pos);
      if (sCh === "\\") {
        str = str + "\\";
        this.pos = this.pos + 1;
        if (this.pos < this.len) {
          str = str + this.input.charAt(this.pos);
          this.pos = this.pos + 1;
        }
      } else if (sCh === '"') {
        this.pos = this.pos + 1;
        return str + '"';
      } else {
        str = str + sCh;
        this.pos = this.pos + 1;
      }
    }
    return this.error("unterminated string");
  }

  parseNumber(): string {
    const numStart = this.pos;
    if (this.pos < this.len && this.input.charAt(this.pos) === "-") {
      this.pos = this.pos + 1;
    }
    while (this.pos < this.len) {
      const nCh = this.input.charAt(this.pos);
      if (
        nCh === "0" ||
        nCh === "1" ||
        nCh === "2" ||
        nCh === "3" ||
        nCh === "4" ||
        nCh === "5" ||
        nCh === "6" ||
        nCh === "7" ||
        nCh === "8" ||
        nCh === "9"
      ) {
        this.pos = this.pos + 1;
      } else {
        break;
      }
    }
    if (this.pos < this.len && this.input.charAt(this.pos) === ".") {
      this.pos = this.pos + 1;
      while (this.pos < this.len) {
        const dCh = this.input.charAt(this.pos);
        if (
          dCh === "0" ||
          dCh === "1" ||
          dCh === "2" ||
          dCh === "3" ||
          dCh === "4" ||
          dCh === "5" ||
          dCh === "6" ||
          dCh === "7" ||
          dCh === "8" ||
          dCh === "9"
        ) {
          this.pos = this.pos + 1;
        } else {
          break;
        }
      }
    }
    if (this.pos < this.len) {
      const expCh = this.input.charAt(this.pos);
      if (expCh === "e" || expCh === "E") {
        this.pos = this.pos + 1;
        if (this.pos < this.len) {
          const signCh = this.input.charAt(this.pos);
          if (signCh === "+" || signCh === "-") {
            this.pos = this.pos + 1;
          }
        }
        while (this.pos < this.len) {
          const eCh = this.input.charAt(this.pos);
          if (
            eCh === "0" ||
            eCh === "1" ||
            eCh === "2" ||
            eCh === "3" ||
            eCh === "4" ||
            eCh === "5" ||
            eCh === "6" ||
            eCh === "7" ||
            eCh === "8" ||
            eCh === "9"
          ) {
            this.pos = this.pos + 1;
          } else {
            break;
          }
        }
      }
    }
    return this.input.substring(numStart, this.pos);
  }

  parseObject(): string {
    this.pos = this.pos + 1;
    this.depth = this.depth + 1;
    this.skipWhitespace();
    if (this.pos < this.len && this.input.charAt(this.pos) === "}") {
      this.pos = this.pos + 1;
      this.depth = this.depth - 1;
      return "{}";
    }
    let obj = "{";
    if (this.pretty) {
      obj = obj + "\n";
    }
    let objFirst = true;
    while (this.pos < this.len && this.input.charAt(this.pos) !== "}") {
      if (!objFirst) {
        obj = obj + ",";
        if (this.pretty) {
          obj = obj + "\n";
        }
      }
      objFirst = false;
      this.skipWhitespace();
      if (this.pos < this.len && this.input.charAt(this.pos) === "}") {
        break;
      }
      if (this.pretty) {
        obj = obj + this.indent();
      }
      const objKey = this.parseString();
      this.skipWhitespace();
      if (this.pos >= this.len || this.input.charAt(this.pos) !== ":") {
        return this.error("expected ':'");
      }
      this.pos = this.pos + 1;
      this.skipWhitespace();
      const objVal = this.parseValue();
      if (this.pretty) {
        obj = obj + objKey + ": " + objVal;
      } else {
        obj = obj + objKey + ":" + objVal;
      }
      this.skipWhitespace();
      if (this.pos < this.len && this.input.charAt(this.pos) === ",") {
        this.pos = this.pos + 1;
        this.skipWhitespace();
      }
    }
    if (this.pos >= this.len) {
      return this.error("unterminated object");
    }
    this.pos = this.pos + 1;
    this.depth = this.depth - 1;
    if (this.pretty) {
      obj = obj + "\n" + this.indent();
    }
    obj = obj + "}";
    return obj;
  }

  parseArray(): string {
    this.pos = this.pos + 1;
    this.depth = this.depth + 1;
    this.skipWhitespace();
    if (this.pos < this.len && this.input.charAt(this.pos) === "]") {
      this.pos = this.pos + 1;
      this.depth = this.depth - 1;
      return "[]";
    }
    let arr = "[";
    if (this.pretty) {
      arr = arr + "\n";
    }
    let arrFirst = true;
    while (this.pos < this.len && this.input.charAt(this.pos) !== "]") {
      if (!arrFirst) {
        arr = arr + ",";
        if (this.pretty) {
          arr = arr + "\n";
        }
      }
      arrFirst = false;
      this.skipWhitespace();
      if (this.pos < this.len && this.input.charAt(this.pos) === "]") {
        break;
      }
      if (this.pretty) {
        arr = arr + this.indent();
      }
      const arrVal = this.parseValue();
      arr = arr + arrVal;
      this.skipWhitespace();
      if (this.pos < this.len && this.input.charAt(this.pos) === ",") {
        this.pos = this.pos + 1;
        this.skipWhitespace();
      }
    }
    if (this.pos >= this.len) {
      return this.error("unterminated array");
    }
    this.pos = this.pos + 1;
    this.depth = this.depth - 1;
    if (this.pretty) {
      arr = arr + "\n" + this.indent();
    }
    arr = arr + "]";
    return arr;
  }

  parseLiteral(): string {
    const litCh = this.input.charAt(this.pos);
    if (litCh === "t" && this.matchLiteral("true")) {
      this.pos = this.pos + 4;
      return "true";
    }
    if (litCh === "f" && this.matchLiteral("false")) {
      this.pos = this.pos + 5;
      return "false";
    }
    if (litCh === "n" && this.matchLiteral("null")) {
      this.pos = this.pos + 4;
      return "null";
    }
    return this.error("unexpected literal");
  }

  matchLiteral(s: string): boolean {
    const slen = s.length;
    if (this.pos + slen > this.len) {
      return false;
    }
    let mlIdx = 0;
    while (mlIdx < slen) {
      if (this.input.charAt(this.pos + mlIdx) !== s.charAt(mlIdx)) {
        return false;
      }
      mlIdx = mlIdx + 1;
    }
    return true;
  }

  skipWhitespace(): void {
    while (this.pos < this.len) {
      const wsCh = this.input.charAt(this.pos);
      if (wsCh === " " || wsCh === "\n" || wsCh === "\r" || wsCh === "\t") {
        this.pos = this.pos + 1;
      } else if (wsCh === "/" && this.pos + 1 < this.len) {
        const nextCh = this.input.charAt(this.pos + 1);
        if (nextCh === "/") {
          this.pos = this.pos + 2;
          while (this.pos < this.len && this.input.charAt(this.pos) !== "\n") {
            this.pos = this.pos + 1;
          }
          if (this.pos < this.len) {
            this.pos = this.pos + 1;
          }
        } else if (nextCh === "*") {
          this.pos = this.pos + 2;
          while (this.pos + 1 < this.len) {
            if (this.input.charAt(this.pos) === "*" && this.input.charAt(this.pos + 1) === "/") {
              this.pos = this.pos + 2;
              break;
            }
            this.pos = this.pos + 1;
          }
        } else {
          return;
        }
      } else {
        return;
      }
    }
  }

  indent(): string {
    let spaces = "";
    let indIdx = 0;
    while (indIdx < this.depth) {
      spaces = spaces + "  ";
      indIdx = indIdx + 1;
    }
    return spaces;
  }

  error(msg: string): string {
    console.error("jsonc: error at position " + this.pos + ": " + msg);
    process.exit(1);
    return "";
  }
}

const argParser = new ArgumentParser(
  "jsonc",
  "JSONC to JSON converter — strips comments and trailing commas",
);
argParser.addFlag("pretty", "p", "Pretty-print the output");
argParser.addFlag("validate", "v", "Validate only (exit 0 if valid, 1 if not)");
argParser.addPositional("file", "JSONC file to convert");
argParser.parse(process.argv);

const filePath = argParser.getPositional(0);
if (filePath.length === 0) {
  console.error("jsonc: missing file argument");
  console.error("Try 'jsonc --help' for more information");
  process.exit(1);
}

const content = fs.readFileSync(filePath);
if (content.length === 0) {
  console.error("jsonc: empty file: " + filePath);
  process.exit(1);
}

const pretty = argParser.getFlag("pretty");
const validate = argParser.getFlag("validate");

const parser = new JsoncParser(content, pretty);
const jsonResult = parser.parse();

if (validate) {
  process.exit(0);
}

console.log(jsonResult);

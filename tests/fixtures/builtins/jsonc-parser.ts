// @test-description: jsonc parser strips comments and trailing commas

class JsoncParser {
  input: string;
  pos: number;
  len: number;

  constructor(input: string) {
    this.input = input;
    this.pos = 0;
    this.len = input.length;
  }

  parse(): string {
    this.skipWhitespace();
    const parseResult = this.parseValue();
    this.skipWhitespace();
    return parseResult;
  }

  parseValue(): string {
    this.skipWhitespace();
    if (this.pos >= this.len) {
      return this.error("unexpected end");
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
    if (ch === "-" || ch === "0" || ch === "1" || ch === "2" || ch === "3" || ch === "4" || ch === "5" || ch === "6" || ch === "7" || ch === "8" || ch === "9") {
      return this.parseNumber();
    }
    if (ch === "t" || ch === "f" || ch === "n") {
      return this.parseLiteral();
    }
    return this.error("unexpected: " + ch);
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
      if (nCh === "0" || nCh === "1" || nCh === "2" || nCh === "3" || nCh === "4" || nCh === "5" || nCh === "6" || nCh === "7" || nCh === "8" || nCh === "9") {
        this.pos = this.pos + 1;
      } else {
        break;
      }
    }
    if (this.pos < this.len && this.input.charAt(this.pos) === ".") {
      this.pos = this.pos + 1;
      while (this.pos < this.len) {
        const dCh = this.input.charAt(this.pos);
        if (dCh === "0" || dCh === "1" || dCh === "2" || dCh === "3" || dCh === "4" || dCh === "5" || dCh === "6" || dCh === "7" || dCh === "8" || dCh === "9") {
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
          if (eCh === "0" || eCh === "1" || eCh === "2" || eCh === "3" || eCh === "4" || eCh === "5" || eCh === "6" || eCh === "7" || eCh === "8" || eCh === "9") {
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
    let obj = "{";
    this.skipWhitespace();
    let objFirst = true;
    while (this.pos < this.len && this.input.charAt(this.pos) !== "}") {
      if (!objFirst) {
        obj = obj + ",";
      }
      objFirst = false;
      this.skipWhitespace();
      if (this.pos < this.len && this.input.charAt(this.pos) === "}") {
        break;
      }
      const objKey = this.parseString();
      this.skipWhitespace();
      if (this.pos >= this.len || this.input.charAt(this.pos) !== ":") {
        return this.error("expected ':'");
      }
      this.pos = this.pos + 1;
      this.skipWhitespace();
      const objVal = this.parseValue();
      obj = obj + objKey + ":" + objVal;
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
    obj = obj + "}";
    return obj;
  }

  parseArray(): string {
    this.pos = this.pos + 1;
    let arr = "[";
    this.skipWhitespace();
    let arrFirst = true;
    while (this.pos < this.len && this.input.charAt(this.pos) !== "]") {
      if (!arrFirst) {
        arr = arr + ",";
      }
      arrFirst = false;
      this.skipWhitespace();
      if (this.pos < this.len && this.input.charAt(this.pos) === "]") {
        break;
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

  error(msg: string): string {
    console.error("jsonc error at " + this.pos + ": " + msg);
    process.exit(1);
    return "";
  }
}

let passed = 0;
let failed = 0;

function check(name: string, input: string, expected: string): void {
  const p = new JsoncParser(input);
  const checkResult = p.parse();
  if (checkResult === expected) {
    passed = passed + 1;
  } else {
    console.log("FAIL: " + name);
    console.log("  expected: " + expected);
    console.log("  got:      " + checkResult);
    failed = failed + 1;
  }
}

check("simple object", '{"a":1}', '{"a":1}');
check("line comment", '{"a":1} // comment', '{"a":1}');
check("block comment", '{"a": /* inline */ 1}', '{"a":1}');
check("trailing comma object", '{"a":1, "b":2,}', '{"a":1,"b":2}');
check("trailing comma array", '[1, 2, 3,]', '[1,2,3]');
check("nested comments", '{\n  // comment\n  "x": [1, /* c */ 2]\n}', '{"x":[1,2]}');
check("string escapes", '"hello\\nworld"', '"hello\\nworld"');
check("negative number", '{"n":-42}', '{"n":-42}');
check("float", '{"f":3.14}', '{"f":3.14}');
check("exponent", '{"e":1.5e2}', '{"e":1.5e2}');
check("literals", '{"a":true,"b":false,"c":null}', '{"a":true,"b":false,"c":null}');
check("empty object", '{}', '{}');
check("empty array", '[]', '[]');
check("nested arrays", '[[1,2],[3]]', '[[1,2],[3]]');
check("multiline block comment", '{\n  /*\n   * multi\n   * line\n   */\n  "x": 1\n}', '{"x":1}');

if (failed === 0) {
  console.log("TEST_PASSED (" + passed + " checks)");
} else {
  console.log("FAILED: " + failed + " of " + (passed + failed));
  process.exit(1);
}

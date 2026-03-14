class Tokenizer {
  split(input: string): string[] {
    const result: string[] = [];
    let current: string = "";
    for (let i: number = 0; i < input.length; i++) {
      const ch: string = input[i];
      if (ch === " ") {
        if (current.length > 0) {
          result.push(current);
          current = "";
        }
      } else {
        current = current + ch;
      }
    }
    if (current.length > 0) {
      result.push(current);
    }
    return result;
  }
}

const t: Tokenizer = new Tokenizer();
const tokens: string[] = t.split("hello world foo");
if (tokens.length === 3 && tokens[0] === "hello" && tokens[1] === "world" && tokens[2] === "foo") {
  console.log("TEST_PASSED");
} else {
  console.log("FAIL: got " + tokens.length.toString() + " tokens");
}

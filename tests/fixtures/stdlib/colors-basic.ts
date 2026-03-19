import { red, green, bold, stripAnsi } from "chadscript/colors";

const r = red("hello");
if (r === "\x1b[31mhello\x1b[0m") {
  const g = green("world");
  if (g === "\x1b[32mworld\x1b[0m") {
    const b = bold(red("error"));
    const stripped = stripAnsi(b);
    if (stripped === "error") {
      console.log("TEST_PASSED");
    }
  }
}

import { match } from "chadscript/glob";

let pass = true;

if (!match("*.ts", "hello.ts")) pass = false;
if (match("*.ts", "hello.js")) pass = false;
if (!match("src/**/*.ts", "src/foo/bar.ts")) pass = false;
if (!match("src/**/baz.ts", "src/a/b/baz.ts")) pass = false;
if (match("src/*.ts", "src/a/b.ts")) pass = false;
if (!match("?.ts", "a.ts")) pass = false;
if (match("?.ts", "ab.ts")) pass = false;
if (!match("**", "anything/goes/here")) pass = false;

if (pass) {
  console.log("TEST_PASSED");
}

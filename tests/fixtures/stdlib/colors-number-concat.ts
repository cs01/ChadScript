import { magenta, cyan } from "chadscript/colors";

function searchFile(): void {
  const count = 42;
  let output = "";
  output = magenta("file") + cyan(":") + count;
  console.log(output);
}

searchFile();
console.log("TEST_PASSED");

const items: string[] = ["hello", " ", "world", "!"];
let result = "";
let i = 0;
while (i < items.length) {
  let line = "  ";
  line = line + items[i];
  result = result + line + "\n";
  i = i + 1;
}
if (result === "  hello\n   \n  world\n  !\n") {
  console.log("TEST_PASSED");
}

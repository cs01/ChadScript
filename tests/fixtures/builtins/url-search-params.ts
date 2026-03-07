const p = new URLSearchParams("q=hello&page=2");

if (p.get("q") !== "hello") {
  console.log("FAIL: get q got " + p.get("q"));
  process.exit(1);
}
if (p.get("page") !== "2") {
  console.log("FAIL: get page got " + p.get("page"));
  process.exit(1);
}
if (!p.has("q")) {
  console.log("FAIL: has q returned false");
  process.exit(1);
}
if (p.has("missing")) {
  console.log("FAIL: has missing returned true");
  process.exit(1);
}

p.set("q", "world");
if (p.get("q") !== "world") {
  console.log("FAIL: after set q got " + p.get("q"));
  process.exit(1);
}

p.append("tag", "foo");
if (p.get("tag") !== "foo") {
  console.log("FAIL: after append tag got " + p.get("tag"));
  process.exit(1);
}

p.delete("page");
if (p.has("page")) {
  console.log("FAIL: page still present after delete");
  process.exit(1);
}

const str = p.toString();
if (str !== "q=world&tag=foo") {
  console.log("FAIL: toString got " + str);
  process.exit(1);
}

console.log("TEST_PASSED");

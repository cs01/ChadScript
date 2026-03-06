const u = new URL("https://example.com:8080/path/to/page?q=hello&page=2#section");

if (u.protocol !== "https:") {
  console.log("FAIL: protocol got " + u.protocol);
  process.exit(1);
}
if (u.hostname !== "example.com") {
  console.log("FAIL: hostname got " + u.hostname);
  process.exit(1);
}
if (u.port !== "8080") {
  console.log("FAIL: port got " + u.port);
  process.exit(1);
}
if (u.host !== "example.com:8080") {
  console.log("FAIL: host got " + u.host);
  process.exit(1);
}
if (u.pathname !== "/path/to/page") {
  console.log("FAIL: pathname got " + u.pathname);
  process.exit(1);
}
if (u.search !== "?q=hello&page=2") {
  console.log("FAIL: search got " + u.search);
  process.exit(1);
}
if (u.hash !== "#section") {
  console.log("FAIL: hash got " + u.hash);
  process.exit(1);
}
if (u.origin !== "https://example.com:8080") {
  console.log("FAIL: origin got " + u.origin);
  process.exit(1);
}
if (u.href !== "https://example.com:8080/path/to/page?q=hello&page=2#section") {
  console.log("FAIL: href got " + u.href);
  process.exit(1);
}

console.log("TEST_PASSED");

const tags: Set<string> = new Set();

tags.add("javascript");
tags.add("typescript");
tags.add("rust");

if (tags.has("typescript")) {
  console.log("found typescript");
}

if (tags.has("python")) {
  console.log("found python");
} else {
  console.log("python not found");
}

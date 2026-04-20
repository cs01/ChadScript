// @chadscript: interpret
// @test-skip
// @test-description: libnode pragma has fs + __filename; reads its own source file
const fs = require("fs");
const d = fs.readFileSync(__filename, "utf8");
console.log("len=" + d.length);

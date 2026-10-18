// console.error/warn format like console.log onto stderr; info/debug go to stdout. Interleaved
// with log to check that each line lands on its own stream.
console.log("out", 1);
console.error("err", 2, [1, 2], { a: "x" });
console.info("info", true);
console.warn("warn %s=%d", "n", 5);
console.debug("debug");
console.error();
console.log("done");

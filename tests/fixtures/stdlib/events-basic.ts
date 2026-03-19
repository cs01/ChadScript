// @test-skip
// EventEmitter requires function-pointer calling which isn't supported yet
import { EventEmitter } from "chadscript/events";

const ee = new EventEmitter();
const results: string[] = [];

function handler(data: string): void {
  results.push(data);
}

ee.on("msg", handler);
ee.emit("msg", "a");
ee.emit("msg", "b");

if (results.length === 2 && results[0] === "a" && results[1] === "b") {
  console.log("TEST_PASSED");
}

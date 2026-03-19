// Timers - demonstrates setTimeout and setInterval with the libuv event loop

let counter: number = 0;

function onTimeout(): void {
  console.log("  [timeout] fired after 500ms");
}

function onInterval(): void {
  counter = counter + 1;
  if (counter == 1) {
    console.log("  [interval] tick 1");
  } else if (counter == 2) {
    console.log("  [interval] tick 2");
  } else if (counter == 3) {
    console.log("  [interval] tick 3 - done!");
    process.exit(0);
  }
}

console.log("Timers Demo");
console.log("  scheduling setTimeout(500ms) and setInterval(200ms)");
console.log("  interval will fire 3 times then exit");
console.log("");

setTimeout(onTimeout, 500);
setInterval(onInterval, 200);
runEventLoop();

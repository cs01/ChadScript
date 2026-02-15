let counter: number = 0;

function onTimeout(): void {
  console.log("Timeout fired after 500ms!");
}

function onInterval(): void {
  counter = counter + 1;
  if (counter == 1) {
    console.log("Interval 1");
  } else if (counter == 2) {
    console.log("Interval 2");
  } else if (counter == 3) {
    console.log("Interval 3");
    process.exit(0);
  }
}

console.log("Starting timers...");
setTimeout(onTimeout, 500);
setInterval(onInterval, 200);
runEventLoop();

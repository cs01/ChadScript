// process.exitCode sets the status of a normal exit; the last write wins and it wraps mod 256.
const EXIT_USAGE = 2;
function check(args: string[]): void {
  if (args.length === 0) process.exitCode = EXIT_USAGE;
}
console.log("start");
process.exitCode = 300;
check([]);
console.log("end");

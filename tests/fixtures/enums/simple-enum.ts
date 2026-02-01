enum LogLevel {
  Silent = 0,
  Normal = 1,
  Verbose = 2,
  Debug = 3,
  Trace = 4
}

const level = LogLevel.Normal;
console.log(level);

console.log(LogLevel.Silent);
console.log(LogLevel.Verbose);
console.log(LogLevel.Debug);
console.log(LogLevel.Trace);

function isVerbose(lvl: number): boolean {
  return lvl >= LogLevel.Verbose;
}

console.log(isVerbose(LogLevel.Normal));
console.log(isVerbose(LogLevel.Debug));

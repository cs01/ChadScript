// finally with return overrides a break
function f5(): string {
  for (let i = 0; i < 3; i++) {
    try {
      break;
    } finally {
      return "finally-won-" + i;
    }
  }
  return "loop-ended";
}
// break through try/catch/finally
function f6(): string {
  let log = "";
  for (let i = 0; i < 3; i++) {
    try {
      if (i === 1) {
        throw new Error("x");
      }
      if (i === 2) {
        break;
      }
      log += "ok" + i + ";";
    } catch {
      log += "caught" + i + ";";
    } finally {
      log += "fin" + i + ";";
    }
  }
  return log;
}
console.log(f5());
console.log(f6());

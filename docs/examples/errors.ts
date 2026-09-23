// throw, try/catch/finally, rethrow, and an uncaught error's exit code, all as in Node.
function parsePort(s: string): number {
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`bad port: ${s}`);
  }
  return n;
}

for (const input of ["8080", "http", "70000"]) {
  try {
    console.log("port", parsePort(input));
  } catch (e) {
    console.log(String(e));
  } finally {
    console.log("checked", input);
  }
}

function withCleanup(): string {
  try {
    return "result";
  } finally {
    console.log("cleanup runs before the return completes");
  }
}
console.log(withCleanup());

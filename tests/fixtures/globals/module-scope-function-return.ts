// Module-scope variable from function call — tests global i8* fallback for calls
function getMessage(): string {
  return "hello from function";
}
const msg = getMessage();
console.log(msg);
console.log("TEST_PASSED");

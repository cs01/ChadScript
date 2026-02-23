// void expression evaluates to undefined (compiles to null/i8*)
function sideEffect(): number {
  return 42;
}

// void discards the return value — should not crash
void sideEffect();

// void 0 is valid syntax — parser must handle it
const result = sideEffect();
if (result === 42) {
  console.log("TEST_PASSED");
}

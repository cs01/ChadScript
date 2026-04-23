// @test-compile-error: inline type assertion 'as { ... }' is unsafe
const obj = { name: "alice", age: 30 };
const typed = obj as { age: number; name: string };
console.log(typed.age);

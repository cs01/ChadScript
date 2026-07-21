// @test-skip
// @test-description: calling string methods on numbers is a compile error
//
// KNOWN GAP (salvage baseline): NEITHER host implements the "string method on number"
// semantic check. Both currently emit invalid LLVM IR (a double/i64 used where a ptr is
// expected) and fail inside clang, i.e. this "negative" fixture only ever "passed" via an
// unrelated compile failure, never a real diagnostic. Skipped until the type check lands
// (salvage tranche 3/4); re-enable with a @test-compile-error asserting the real message.
const x: number = 42;
const result = x.trim();
console.log(result);

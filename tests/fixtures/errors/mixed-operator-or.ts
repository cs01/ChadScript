// @test-compile-error: type mismatch in '||'
let x: string = "hello";
let y: number = 42;
const z = x || y;
console.log(z);

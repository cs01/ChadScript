// @test-exit-code: 0
// Test new array methods: pop, includes

const arr1 = [10, 20, 30, 40, 50];
console.log("pop()=" + arr1.pop());
console.log("length after pop=" + arr1.length);

const arr2 = [10, 20, 30, 40, 50];
console.log("includes(30)=" + arr2.includes(30));
console.log("includes(99)=" + arr2.includes(99));

process.exit(0);

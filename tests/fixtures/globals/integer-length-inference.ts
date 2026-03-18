const arr = [1, 2, 3, 4, 5];
let total = 0;
for (let i = 0; i < arr.length; i++) {
  total = total + 1;
}

const str = "hello world";
let count = 0;
for (let j = 0; j < str.length; j++) {
  count = count + 1;
}

let x = 0;
x = str.indexOf("world");
const sum = total + count + x;

if (total === 5 && count === 11 && sum === 22) {
  console.log("TEST_PASSED");
}

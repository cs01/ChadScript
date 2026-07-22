// @expect-reject: CS1219
let count = 0;
const inc = () => {
  count = count + 1;
};
inc();
console.log(count);

// @known-bug: phase 5 (heap-cell captures): a closure mutating an outer let is rejected (CS1219)
let count = 0;
const inc = (): void => {
  count++;
};
inc();
inc();
console.log(count);

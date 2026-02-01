const p = Promise.resolve("hello");
p.then((value) => {
  console.log(value);
});
console.log("done");

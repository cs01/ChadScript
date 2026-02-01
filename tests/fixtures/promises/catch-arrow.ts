const p = Promise.reject("error message");
p.catch((err) => {
  console.log("Caught:");
  console.log(err);
});
console.log("after catch");

try {
  console.log("before throw");
  throw "oops";
} catch (e) {
  console.log("caught:", e);
}
console.log("after try");

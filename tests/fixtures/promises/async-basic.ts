async function getValue(): any {
  return "hello from async";
}

const p = getValue();
p.then((result) => {
  console.log(result);
});

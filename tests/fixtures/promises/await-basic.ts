async function fetchData(): any {
  const result = await Promise.resolve("awaited value");
  return result;
}

const p = fetchData();
p.then((value) => {
  console.log(value);
});

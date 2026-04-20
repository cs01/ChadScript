const COUNT = 100000;

const jsonStrings = [];
for (let i = 0; i < COUNT; i++) {
  jsonStrings.push(`{"id":${i},"name":"item${i}","value":${(i * 3.14).toFixed(2)},"active":true}`);
}

const start = performance.now();

const items = [];
for (let i = 0; i < COUNT; i++) {
  items.push(JSON.parse(jsonStrings[i]));
}

const outputs = [];
for (let i = 0; i < COUNT; i++) {
  outputs.push(JSON.stringify(items[i]));
}

const elapsed = (performance.now() - start) / 1000;
console.log(`Objects:  ${COUNT}`);
console.log(`Check:    ${items[0].name}`);
console.log(`OutLen:   ${outputs[0].length}`);
console.log(`Time:     ${elapsed.toFixed(3)}s`);

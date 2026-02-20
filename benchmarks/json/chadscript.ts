const COUNT = 10000;

interface Item {
  id: number;
  name: string;
  value: number;
  active: boolean;
}

function run(): void {
  const jsonStrings: string[] = [];
  let i = 0;
  while (i < COUNT) {
    jsonStrings.push(
      '{"id":' + i + ',"name":"item' + i + '","value":' + i * 3.14 + ',"active":true}',
    );
    i = i + 1;
  }

  const start = Date.now();

  const items: Item[] = [];
  let j = 0;
  while (j < COUNT) {
    const item = JSON.parse<Item>(jsonStrings[j]);
    items.push(item);
    j = j + 1;
  }

  const outputs: string[] = [];
  let k = 0;
  while (k < COUNT) {
    outputs.push(JSON.stringify(items[k]));
    k = k + 1;
  }

  const elapsed = (Date.now() - start) / 1000;
  console.log("Objects:  " + COUNT);
  console.log("Check:    " + items[0].name);
  console.log("OutLen:   " + outputs[0].length);
  console.log("Time:     " + elapsed + "s");
}

run();

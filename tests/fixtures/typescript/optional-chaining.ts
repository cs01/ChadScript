class Config {
  name: string;
  value: number;

  constructor() {
    this.name = "default";
    this.value = 42;
  }
}

const c = new Config();
const n = c?.name;
console.log(n);

const v = c?.value;
console.log(v.toFixed(0));

const s = "hello";
const len = s?.length;
console.log(len.toFixed(0));

console.log("TEST_PASSED");

let counter: number = 0;

function increment(): void {
  counter = counter + 1;
}

function getCounter(): number {
  return counter;
}

increment();
increment();
increment();
console.log(getCounter());

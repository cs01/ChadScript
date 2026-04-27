class Box<T> {
  value: T;
  constructor(v: T) {
    this.value = v;
  }
  getValue(): T {
    return this.value;
  }
}

const numBox = new Box<number>(42);
console.log(numBox.getValue());
console.log(numBox.value);

const strBox = new Box<string>("hello");
console.log(strBox.getValue());
console.log(strBox.value);

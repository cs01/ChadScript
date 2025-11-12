class Counter {
  constructor(value) {
    this.value = value;
  }
  
  getValue() {
    return this.value;
  }
}

process.exit(new Counter(10).getValue());


class Test {
  code: string;

  constructor(code) {
    this.code = code;
  }

  testMethod() {
    const result = this.code.substring(0, 5);
    console.log(result);
    return 0;
  }
}

function main() {
  const t = new Test("Hello World");
  const result = t.testMethod();
  return result;
}

process.exit(main());

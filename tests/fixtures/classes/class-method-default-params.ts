class Greeter {
  greet(name: string = "world"): string {
    return "hi " + name;
  }
}

class Formatter {
  format(text: string, prefix: string = "[", suffix: string = "]"): string {
    return prefix + text + suffix;
  }
}

class Calculator {
  add(a: number, b: number = 10): number {
    return a + b;
  }
}

const g: Greeter = new Greeter();
const f: Formatter = new Formatter();
const c: Calculator = new Calculator();

let pass: boolean = true;

if (g.greet() !== "hi world") { console.log("FAIL greet()"); pass = false; }
if (g.greet("chad") !== "hi chad") { console.log("FAIL greet(chad)"); pass = false; }

if (f.format("x") !== "[x]") { console.log("FAIL format(x)"); pass = false; }
if (f.format("x", "<") !== "<x]") { console.log("FAIL format(x, <)"); pass = false; }
if (f.format("x", "<", ">") !== "<x>") { console.log("FAIL format(x, <, >)"); pass = false; }

if (c.add(5) !== 15) { console.log("FAIL add(5)"); pass = false; }
if (c.add(5, 20) !== 25) { console.log("FAIL add(5, 20)"); pass = false; }

if (pass) { console.log("TEST_PASSED"); }

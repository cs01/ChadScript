// @test-description: nested member access with index access resolves element type
class Item {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
}

class Container {
  items: Item[];
  constructor() {
    this.items = [];
  }
  addItem(name: string): void {
    this.items.push(new Item(name));
  }
}

class App {
  container: Container;
  constructor() {
    this.container = new Container();
    this.container.addItem("hello");
    this.container.addItem("world");
  }
  run(): void {
    const first: Item = this.container.items[0];
    const second: Item = this.container.items[1];
    if (first.name === "hello" && second.name === "world") {
      console.log("TEST_PASSED");
    }
  }
}

const app = new App();
app.run();

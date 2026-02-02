interface DataSource {
  title: string;
  tags: string[];
}

class TestClass {
  private source: DataSource;

  constructor() {
    this.source = {
      title: "hello",
      tags: ["a", "b"]
    };
  }

  getData(): { name: string; items: string[] } | undefined {
    return {
      name: this.source.title,
      items: this.source.tags
    };
  }
}

const t = new TestClass();
const result = t.getData();
if (result) {
  console.log(result.name);
}

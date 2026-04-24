// @test-description: subscript on this.field.method() returning string[] resolves correctly
class TagStore {
  tags: string[] = [];
  getAllTags(): string[] {
    const r: string[] = [];
    for (let i = 0; i < this.tags.length; i++) {
      r.push(this.tags[i]);
    }
    return r;
  }
}

class Registry {
  store: TagStore;
  constructor() {
    this.store = new TagStore();
  }
  check(): void {
    this.store.tags.push("alpha");
    this.store.tags.push("beta");
    const all = this.store.getAllTags();
    const last = all[all.length - 1];
    if (last === "beta") {
      console.log("TEST_PASSED");
    }
  }
}

function main(): void {
  const r = new Registry();
  r.check();
}
main();

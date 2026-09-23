// @expect-reject: CS1238
class Tag {
  toString(): string {
    return "tag";
  }
}
const tags: Tag[] = [new Tag(), new Tag()];
console.log(`${tags}`);

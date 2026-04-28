const re = new RegExp("hello", "i");
console.log(re.test("Hello World"));
console.log(re.test("goodbye"));

console.log(new RegExp("[0-9]+").test("abc123"));
console.log(new RegExp("[0-9]+").test("abcdef"));

const replaced = "hello world".replace(new RegExp("world"), "there");
console.log(replaced);

const replaced2 = "aaa".replace(new RegExp("a", "g"), "b");
console.log(replaced2);

const replaced3 = "foo bar foo".replace(new RegExp("foo"), "baz");
console.log(replaced3);

const replaced4 = "foo bar foo".replace(new RegExp("foo", "g"), "baz");
console.log(replaced4);

const json = '{"name": "chad", "age": 30, "active": true}';
const obj: any = JSON.parse(json);
const name: string = obj.name;
const age: number = obj.age;
console.log(name);
console.log(age);

const nested = '{"user": {"name": "alice"}, "scores": [10, 20, 30]}';
const data: any = JSON.parse(nested);
const userName: string = data.user.name;
console.log(userName);

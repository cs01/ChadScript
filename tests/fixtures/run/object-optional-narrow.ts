interface User {
  id: number;
  nickname?: string;
}
function greet(u: User): string {
  const nick = u.nickname;
  if (nick !== undefined) {
    return "Hi " + nick;
  }
  return "Hi user " + u.id;
}
console.log(greet({ id: 1, nickname: "ace" }));
console.log(greet({ id: 2 }));

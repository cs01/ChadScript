s = "  hello world  "
print(s.strip())
print(s.lstrip())
print(s.rstrip())

s2 = "hello world hello"
print(s2.replace("hello", "hi"))
print(s2.startswith("hello"))
print(s2.endswith("hello"))
print(s2.find("world"))
print(s2.find("xyz"))

print("name: {}, age: {}".format("alice", 30))

d = {"a": 1, "b": 2}
d.update({"c": 3, "b": 99})
print(d["b"])
print(d["c"])
print(len(d))

val = d.pop("a")
print(val)
print(len(d))

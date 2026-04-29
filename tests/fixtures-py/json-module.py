import json

s = json.dumps("hello")
print(s)

n = json.dumps(42)
print(n)

arr_s = json.dumps(["a", "b", "c"])
print(arr_s)

d = {"name": "alice", "city": "nyc"}
print(json.dumps(d))

parsed = json.loads('{"x":"1","y":"2"}')
print(parsed["x"])
print(parsed["y"])

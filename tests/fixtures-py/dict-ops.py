d: dict[str, int] = {"a": 1, "b": 2, "c": 3}
print(d["a"])
print(d["b"])
print(len(d))
d["d"] = 4
print(len(d))
for k in d:
    print(k)
for k, v in d.items():
    print(k)
del d["d"]
print(len(d))

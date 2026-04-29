import os

path = "/tmp/milo-test-io.txt"

f = open(path, "w")
f.write("hello\n")
f.write("world\n")
f.close()

f = open(path, "r")
content = f.read()
f.close()
print(content)

f = open(path, "r")
line1 = f.readline()
line2 = f.readline()
f.close()
print(line1)
print(line2)

f = open(path, "r")
lines = f.readlines()
f.close()
print(len(lines))
for line in lines:
    print(line)

os.remove(path)
print(os.path.exists(path))

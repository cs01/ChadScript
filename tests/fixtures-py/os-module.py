import os

cwd = os.getcwd()
print(len(cwd) > 0)

print(os.path.isdir(cwd))
print(os.path.isfile(cwd))

joined = os.path.join(cwd, "README.md")
print(os.path.basename(joined))
print(os.path.dirname(joined) == cwd)

home = os.getenv("HOME")
print(len(home) > 0)

entries = os.listdir(cwd)
print(len(entries) > 0)

// @expect-reject: CS1247
class Oops {
  code = 1;
}
throw new Oops();

const base62Generator = require("../../utils/base62");

describe("base62 code generator test", () => {
  it("generate random base62 code for 0", () => {
    const num = 0;
    const base62Code = base62Generator(num);
    expect(base62Code).toBe("0");
  });

  it("generate random base62 code for num", () => {
    const num = 20;
    const base62Code = base62Generator(num);
    expect(base62Code).toBe("k");
  });

  it("generates a multi-character code when num >= 62", () => {
    const num = 62;
    const base62Code = base62Generator(num);
    expect(base62Code).toBe("10");
  });
});

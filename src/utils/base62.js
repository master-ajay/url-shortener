const base62Generator = (num) => {
  const Alphabet =
    "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

  if (num === 0) {
    return Alphabet[0];
  }

  let base62 = "";

  while (num > 0) {
    let remainder = num % 62;
    num = Math.floor(num / 62);
    let base62Char = Alphabet[remainder];
    base62 = `${base62Char}` + base62;
  }

  return base62;
};

module.exports = base62Generator;

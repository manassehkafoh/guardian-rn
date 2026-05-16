function constantTimeEqual(a, b) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) {
    diff |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  }
  return diff === 0;
}
console.log(constantTimeEqual("abc", "abc"));
console.log(constantTimeEqual("ab", "abc"));
console.log(constantTimeEqual("abcd", "abc"));
console.log(constantTimeEqual("xbc", "abc"));

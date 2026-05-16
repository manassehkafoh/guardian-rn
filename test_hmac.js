function constantTimeEqual(untrusted, trusted) {
  let diff = untrusted.length ^ trusted.length;
  for (let i = 0; i < trusted.length; i++) {
    diff |= (untrusted.charCodeAt(i) | 0) ^ (trusted.charCodeAt(i) | 0);
  }
  return diff === 0;
}

console.log(constantTimeEqual("abc", "abc")); // true
console.log(constantTimeEqual("ab", "abc")); // false
console.log(constantTimeEqual("abcd", "abc")); // false
console.log(constantTimeEqual("abd", "abc")); // false

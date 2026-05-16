import Foundation

func verify(computed: String, expected: String) -> Bool {
    var diff = computed.utf8.count ^ expected.utf8.count
    var expectedIterator = expected.utf8.makeIterator()

    for computedByte in computed.utf8 {
        let expectedByte = expectedIterator.next() ?? 0
        diff |= Int(computedByte ^ expectedByte)
    }

    return diff == 0
}

print(verify(computed: "sha256=123", expected: "sha256=123"))
print(verify(computed: "sha256=123", expected: "sha256=12"))
print(verify(computed: "sha256=123", expected: "sha256=1234"))
print(verify(computed: "sha256=123", expected: "sha256=124"))

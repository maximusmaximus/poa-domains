// Test-only guaranteed corruption; no key material or production crypto changes.
export function flipCiphertextBit(base64) {
 const bytes=Buffer.from(base64,"base64");
 if(!bytes.length)throw Error("A tamper fixture needs nonempty ciphertext");
 bytes[0]^=1;
 return bytes.toString("base64");
}

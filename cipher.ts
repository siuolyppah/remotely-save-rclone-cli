import { scryptAsync } from "npm:@noble/hashes/scrypt";
import { xsalsa20poly1305 } from "npm:@noble/ciphers/salsa";
import { randomBytes } from "npm:@noble/ciphers/webcrypto";
import { pad, unpad } from "npm:pkcs7-padding";
import { EMECipher, AESCipherBlock } from "npm:@fyears/eme";
import { base32hex, base64url } from "npm:rfc4648";

const newNonce = () => randomBytes(xsalsa20poly1305.nonceLength); // 24

const nameCipherBlockSize = 16; // aes block size
const fileMagic = "RCLONE\x00\x00";
const fileMagicBytes = new TextEncoder().encode(fileMagic);
const fileMagicSize = fileMagic.length;
const fileNonceSize = 24;
const fileHeaderSize = fileMagicSize + fileNonceSize;
const blockHeaderSize = xsalsa20poly1305.tagLength; // 16
const blockDataSize = 64 * 1024;
const blockSize = blockHeaderSize + blockDataSize;
const defaultSalt = new Uint8Array([
  0xa8, 0x0d, 0xf4, 0x3a, 0x8f, 0xbd, 0x03, 0x08, 0xa7, 0xca, 0xb8, 0x3e, 0x58,
  0x1f, 0x86, 0xb1,
]);

export const msgErrorBadDecryptUTF8 = "bad decryption - utf-8 invalid";
export const msgErrorBadDecryptControlChar =
  "bad decryption - contains control chars";
export const msgErrorEncryptedFileTooShort =
  "file is too short to be encrypted";
export const msgErrorEncryptedFileBadHeader = "file has truncated block header";
export const msgErrorEncryptedBadMagic =
  "not an encrypted file - bad magic string";
export const msgErrorEncryptedBadBlock =
  "failed to authenticate decrypted block - bad password?";
export const msgErrorBadBase32Encoding = "bad base32 filename encoding";
export const msgErrorFileClosed = "file already closed";
export const msgErrorNotAnEncryptedFile =
  "not an encrypted file - does not match suffix";
export const msgErrorBadSeek = "Seek beyond end of file";
export const msgErrorSuffixMissingDot =
  "suffix config setting should include a '.'";

type FileNameEncodingType = "base32" | "base64";

// Cipher defines an encoding and decoding cipher for the crypt backend
export class Cipher {
  dataKey: Uint8Array; //  [32]byte                  // Key for secretbox
  nameKey: Uint8Array; //  [32]byte                  // 16,24 or 32 bytes
  nameTweak: Uint8Array;
  fileNameEnc: FileNameEncodingType;
  dirNameEncrypt: boolean;

  constructor(fileNameEnc: FileNameEncodingType) {
    this.dataKey = new Uint8Array(32);
    this.nameKey = new Uint8Array(32);
    this.nameTweak = new Uint8Array(nameCipherBlockSize);
    this.dirNameEncrypt = true;
    this.fileNameEnc = fileNameEnc;
  }

  toString() {
    return `
dataKey=${this.dataKey} 
nameKey=${this.nameKey}
nameTweak=${this.nameTweak}
dirNameEncrypt=${this.dirNameEncrypt}
fileNameEnc=${this.fileNameEnc}
`;
  }

  encodeToString(ciphertext: Uint8Array) {
    if (this.fileNameEnc === "base32") {
      return base32hex.stringify(ciphertext, { pad: false }).toLowerCase();
    } else if (this.fileNameEnc === "base64") {
      return base64url.stringify(ciphertext, { pad: false });
    } else {
      throw Error(`unknown fileNameEnc=${this.fileNameEnc}`);
    }
  }

  decodeString(ciphertext: string) {
    if (this.fileNameEnc === "base32") {
      if (ciphertext.endsWith("=")) {
        throw new Error(msgErrorBadBase32Encoding);
      }
      return base32hex.parse(ciphertext.toUpperCase(), {
        loose: true,
      });
    } else if (this.fileNameEnc === "base64") {
      return base64url.parse(ciphertext, {
        loose: true,
      });
    } else {
      throw Error(`unknown fileNameEnc=${this.fileNameEnc}`);
    }
  }

  async key(password: string, salt: string) {
    const keySize =
      this.dataKey.length + this.nameKey.length + this.nameTweak.length;
    let saltBytes = defaultSalt;
    if (salt !== "") {
      saltBytes = new TextEncoder().encode(salt);
    }
    let key: Uint8Array;
    if (password === "") {
      key = new Uint8Array(keySize);
    } else {
      key = await scryptAsync(new TextEncoder().encode(password), saltBytes, {
        N: 2 ** 14,
        r: 8,
        p: 1,
        dkLen: keySize,
      });
    }
    this.dataKey.set(key.slice(0, this.dataKey.length));
    this.nameKey.set(
      key.slice(this.dataKey.length, this.dataKey.length + this.nameKey.length),
    );
    this.nameTweak.set(key.slice(this.dataKey.length + this.nameKey.length));
    return this;
  }

  updateInternalKey(
    dataKey: Uint8Array,
    nameKey: Uint8Array,
    nameTweak: Uint8Array,
  ) {
    this.dataKey = dataKey;
    this.nameKey = nameKey;
    this.nameTweak = nameTweak;
    return this;
  }

  getInternalKey() {
    return {
      dataKey: this.dataKey,
      nameKey: this.nameKey,
      nameTweak: this.nameTweak,
    };
  }

  async encryptSegment(plaintext: string) {
    if (plaintext === "") {
      return "";
    }
    const paddedPlaintext = pad(
      new TextEncoder().encode(plaintext) as any,
      nameCipherBlockSize,
    );
    const bc = new AESCipherBlock(this.nameKey);
    const eme = new EMECipher(bc);
    const ciphertext = await eme.encrypt(this.nameTweak, paddedPlaintext);
    return this.encodeToString(ciphertext);
  }

  async encryptFileName(input: string) {
    const segments = input.split("/");
    for (let i = 0; i < segments.length; ++i) {
      if (!this.dirNameEncrypt && i !== segments.length - 1) {
        continue;
      }
      segments[i] = await this.encryptSegment(segments[i]);
    }
    return segments.join("/");
  }

  async decryptSegment(ciphertext: string) {
    if (ciphertext === "") {
      return "";
    }
    const rawCiphertext = this.decodeString(ciphertext);
    const bc = new AESCipherBlock(this.nameKey);
    const eme = new EMECipher(bc);
    const paddedPlaintext = await eme.decrypt(this.nameTweak, rawCiphertext);
    const plaintext = unpad(paddedPlaintext as any);
    return new TextDecoder().decode(plaintext);
  }

  async decryptFileName(input: string) {
    const segments = input.split("/");
    for (let i = 0; i < segments.length; ++i) {
      if (!this.dirNameEncrypt && i !== segments.length - 1) {
        continue;
      }
      segments[i] = await this.decryptSegment(segments[i]);
    }
    return segments.join("/");
  }

  async encryptData(input: Uint8Array, nonceInput?: Uint8Array) {
    const nonce = nonceInput ?? newNonce();
    const res = new Uint8Array(encryptedSize(input.byteLength));
    res.set(fileMagicBytes);
    res.set(nonce, fileMagicSize);
    for (
      let offset = 0, i = 0;
      offset < input.byteLength;
      offset += blockDataSize, i += 1
    ) {
      const readBuf = input.slice(offset, offset + blockDataSize);
      const buf = xsalsa20poly1305(this.dataKey, nonce).encrypt(readBuf);
      increment(nonce);
      res.set(
        buf,
        fileMagicSize + fileNonceSize + offset + i * blockHeaderSize,
      );
    }
    return res;
  }

  async decryptData(input: Uint8Array) {
    if (input.byteLength < fileHeaderSize) {
      throw Error(msgErrorEncryptedFileTooShort);
    }
    if (!compArr(input.slice(0, fileMagicSize), fileMagicBytes)) {
      throw Error(msgErrorEncryptedBadMagic);
    }
    const nonce = input.slice(fileMagicSize, fileHeaderSize);
    const res = new Uint8Array(decryptedSize(input.byteLength));
    for (
      let offsetInput = fileHeaderSize, offsetOutput = 0, i = 0;
      offsetInput < input.byteLength;
      offsetInput += blockSize, offsetOutput += blockDataSize, i += 1
    ) {
      const readBuf = input.slice(offsetInput, offsetInput + blockSize);
      const buf = xsalsa20poly1305(this.dataKey, nonce).decrypt(readBuf);
      if (buf === null) {
        throw Error(msgErrorEncryptedBadBlock);
      }
      increment(nonce);
      res.set(buf, offsetOutput);
    }
    return res;
  }
}

export function carry(i: number, n: Uint8Array) {
  for (; i < n.length; i++) {
    const digit = n[i];
    const newDigit = (digit + 1) & 0xff;
    n[i] = newDigit;
    if (newDigit >= digit) {
      break;
    }
  }
}

export function increment(n: Uint8Array) {
  return carry(0, n);
}

export function add(x: number | bigint, n: Uint8Array) {
  let y = BigInt(0);
  if (typeof x === "bigint") {
    y = BigInt.asUintN(64, x);
  } else if (typeof x === "number") {
    y = BigInt.asUintN(64, BigInt(x));
  }
  let carryNum = BigInt.asUintN(16, BigInt(0));

  for (let i = 0; i < 8; i++) {
    const digit = n[i];
    const xDigit = y & BigInt(0xff);
    y >>= BigInt(8);
    carryNum = carryNum + BigInt(digit) + BigInt(xDigit);
    n[i] = Number(carryNum);
    carryNum >>= BigInt(8);
  }
  if (carryNum !== BigInt(0)) {
    carry(8, n);
  }
}

function compArr(x: Uint8Array, y: Uint8Array) {
  if (x.length !== y.length) {
    return false;
  }
  for (let i = 0; i < x.length; ++i) {
    if (x[i] !== y[i]) {
      return false;
    }
  }
  return true;
}

export function encryptedSize(size: number) {
  const blocks = Math.floor(size / blockDataSize);
  const residue = size % blockDataSize;
  let encryptedSize =
    fileHeaderSize + blocks * (blockHeaderSize + blockDataSize);
  if (residue !== 0) {
    encryptedSize += blockHeaderSize + residue;
  }
  return encryptedSize;
}

export function decryptedSize(size: number) {
  let size2 = size;
  size2 -= fileHeaderSize;
  if (size2 < 0) {
    throw new Error(msgErrorEncryptedFileTooShort);
  }
  const blocks = Math.floor(size2 / blockSize);
  let residue = size2 % blockSize;
  let decryptedSize = blocks * blockDataSize;
  if (residue !== 0) {
    residue -= blockHeaderSize;
    if (residue <= 0) {
      throw new Error(msgErrorEncryptedFileBadHeader);
    }
  }
  decryptedSize += residue;
  return decryptedSize;
}

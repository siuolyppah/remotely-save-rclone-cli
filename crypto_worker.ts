import { Cipher } from "./cipher.ts";

self.onmessage = async (e) => {
  const { type, data, cipher, password } = e.data;
  const cipherInstance = new Cipher(cipher);
  await cipherInstance.key(password, "");

  if (type === "encrypt" || type === "decrypt") {
    const result =
      await cipherInstance[type === "encrypt" ? "encryptData" : "decryptData"](
        data,
      );
    self.postMessage(result);
  } else if (type === "decryptPath") {
    const result = await cipherInstance.decryptFileName(data);
    self.postMessage(result);
  }
};

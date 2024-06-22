import { Cipher } from "./cipher.ts";

self.onmessage = async (e) => {
  const { id, type, data, cipher, password } = e.data;
  const cipherInstance = new Cipher(cipher);
  await cipherInstance.key(password, "");

  if (type === "encrypt" || type === "decrypt") {
    const result =
      await cipherInstance[type === "encrypt" ? "encryptData" : "decryptData"](
        data,
      );
    self.postMessage({ id, result });
  } else if (type === "decryptPath") {
    const result = await cipherInstance.decryptFileName(
      new TextDecoder().decode(data),
    );
    self.postMessage({ id, result });
  }
};

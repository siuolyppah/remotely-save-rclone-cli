import { Cipher } from "./cipher.ts";
import { deepStrictEqual } from "node:assert/strict";

(async function () {
  const password = "custom-password";
  const salt = "custom-salt";
  const cipher = new Cipher("base64");
  await cipher.key(password, salt);

  const fileName = "custom-dir/custom-filename";
  const encFileName = await cipher.encryptFileName(fileName);
  console.log("Encrypted File Name:", encFileName);
  const recoveredFileName = await cipher.decryptFileName(encFileName);
  console.log("Recovered File Name:", recoveredFileName);
  deepStrictEqual(fileName, recoveredFileName);

  const fileContent = new Uint8Array([1, 2, 3, 4, 5]); // user provided
  const encFileContent = await cipher.encryptData(fileContent);
  console.log("Encrypted File Content:", encFileContent);
  const recoveredFileContent = await cipher.decryptData(encFileContent);
  console.log("Recovered File Content:", recoveredFileContent);
  deepStrictEqual(fileContent, recoveredFileContent);
})();

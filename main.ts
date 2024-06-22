import { Cipher } from "./cipher.ts";
import { parse } from "https://deno.land/std@0.95.0/flags/mod.ts";
import {
  readFileStr,
  writeFileStr,
} from "https://deno.land/std@0.95.0/fs/mod.ts";
import { exists } from "https://deno.land/std@0.95.0/fs/exists.ts";
import { deepStrictEqual } from "node:assert/strict";

async function main() {
  const args = parse(Deno.args);
  const sourceFilePath = args.source || args.s;
  const targetFilePath = args.target || args.t;
  const password = args.password || args.p;
  const action = args.action || args.a;

  if (!sourceFilePath || !targetFilePath || !password || !action) {
    console.error(
      "Missing required arguments: --source, --target, --password, --action",
    );
    Deno.exit(1);
  }

  if (!(await exists(sourceFilePath))) {
    console.error(`Source file ${sourceFilePath} does not exist.`);
    Deno.exit(1);
  }

  const cipher = new Cipher("base64");
  await cipher.key(password, "");

  const fileContent = new Uint8Array(await Deno.readFile(sourceFilePath));
  let result: Uint8Array;

  if (action === "encrypt") {
    result = await cipher.encryptData(fileContent);
  } else if (action === "decrypt") {
    result = await cipher.decryptData(fileContent);
  } else {
    console.error("Invalid action specified. Use 'encrypt' or 'decrypt'.");
    Deno.exit(1);
  }

  await Deno.writeFile(targetFilePath, result);
  console.log(`File ${action}ed successfully. Saved to ${targetFilePath}`);
}

await main();

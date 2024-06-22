import { Cipher } from "./cipher.ts";
import { parse } from "https://deno.land/std@0.95.0/flags/mod.ts";
import { exists, ensureDir } from "https://deno.land/std@0.95.0/fs/mod.ts";
import { join, relative } from "https://deno.land/std@0.95.0/path/mod.ts";

async function main() {
  const args = parse(Deno.args);
  const sourceFilePath = args.source || args.s;
  const targetFilePath = args.target || args.t;
  const password = args.password || args.p;
  const action = args.action || args.a;
  const saveDir = args.save_dir || args.d;
  const sourceRoot = args.source_root || args.r;

  if (!sourceFilePath || !password || !action) {
    console.error("Missing required arguments: --source, --password, --action");
    Deno.exit(1);
  }

  if (!targetFilePath && (!saveDir || !sourceRoot)) {
    console.error(
      "You must provide either --target or both --save_dir and --source_root",
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
  let finalTargetPath: string;

  if (action === "encrypt") {
    result = await cipher.encryptData(fileContent);
    finalTargetPath = targetFilePath || sourceFilePath;
  } else if (action === "decrypt") {
    result = await cipher.decryptData(fileContent);
    if (targetFilePath) {
      finalTargetPath = targetFilePath;
    } else {
      const relativePath = relative(sourceRoot, sourceFilePath);
      const decryptedFileName = await cipher.decryptFileName(relativePath);
      finalTargetPath = join(saveDir, decryptedFileName);
    }
  } else {
    console.error("Invalid action specified. Use 'encrypt' or 'decrypt'.");
    Deno.exit(1);
  }

  // Ensure the save directory exists
  if (!targetFilePath && saveDir) {
    await ensureDir(saveDir);
  }

  // Ensure the directory for the final target path exists
  await ensureDir(join(finalTargetPath, ".."));

  await Deno.writeFile(finalTargetPath, result);
  console.log(`File ${action}ed successfully. Saved to ${finalTargetPath}`);
}

await main();

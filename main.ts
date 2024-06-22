import { Cipher } from "./cipher.ts";
import { parse } from "https://deno.land/std@0.95.0/flags/mod.ts";
import { exists, ensureDir } from "https://deno.land/std@0.95.0/fs/mod.ts";
import {
  join,
  relative,
  dirname,
} from "https://deno.land/std@0.95.0/path/mod.ts";

async function processFile(
  cipher: Cipher,
  filePath: string,
  targetFilePath: string,
  action: string,
) {
  const fileContent = new Uint8Array(await Deno.readFile(filePath));
  let result: Uint8Array;

  if (action === "encrypt") {
    result = await cipher.encryptData(fileContent);
  } else if (action === "decrypt") {
    result = await cipher.decryptData(fileContent);
  } else {
    throw new Error("Invalid action specified. Use 'encrypt' or 'decrypt'.");
  }

  await ensureDir(dirname(targetFilePath));
  await Deno.writeFile(targetFilePath, result);
  console.log(`File ${action}ed successfully. Saved to ${targetFilePath}`);
}

async function processDirectory(
  cipher: Cipher,
  dirPath: string,
  targetDirPath: string,
  action: string,
  sourceRoot: string,
) {
  for await (const entry of Deno.readDir(dirPath)) {
    const sourcePath = join(dirPath, entry.name);
    let relativePath = relative(sourceRoot, sourcePath);
    if (action === "decrypt") {
      relativePath = await cipher.decryptFileName(relativePath);
    }
    const targetPath = join(targetDirPath, relativePath);

    if (entry.isDirectory) {
      await ensureDir(targetPath);
      await processDirectory(
        cipher,
        sourcePath,
        targetDirPath,
        action,
        sourceRoot,
      );
    } else if (entry.isFile) {
      await processFile(cipher, sourcePath, targetPath, action);
    }
  }
}

async function main() {
  const args = parse(Deno.args);
  const sourcePath = args.source || args.s;
  const targetFilePath = args.target || args.t;
  const password = args.password || args.p;
  const action = args.action || args.a;
  const saveDir = args.save_dir || args.d;
  const sourceRoot = args.source_root || args.r;

  if (!sourcePath || !password || !action) {
    console.error("Missing required arguments: --source, --password, --action");
    Deno.exit(1);
  }

  if (!targetFilePath && (!saveDir || !sourceRoot)) {
    console.error(
      "You must provide either --target or both --save_dir and --source_root",
    );
    Deno.exit(1);
  }

  if (!(await exists(sourcePath))) {
    console.error(`Source path ${sourcePath} does not exist.`);
    Deno.exit(1);
  }

  const cipher = new Cipher("base64");
  await cipher.key(password, "");

  const sourceInfo = await Deno.stat(sourcePath);

  if (sourceInfo.isFile) {
    let finalTargetPath = targetFilePath;
    if (!targetFilePath) {
      const relativePath = relative(sourceRoot, sourcePath);
      const decryptedFileName = await cipher.decryptFileName(relativePath);
      finalTargetPath = join(saveDir, decryptedFileName);
    }

    await processFile(cipher, sourcePath, finalTargetPath, action);
  } else if (sourceInfo.isDirectory) {
    if (!targetFilePath && saveDir) {
      await ensureDir(saveDir);
    }

    await processDirectory(cipher, sourcePath, saveDir, action, sourceRoot);
  } else {
    console.error(
      "Invalid source path specified. It must be a file or directory.",
    );
    Deno.exit(1);
  }
}

await main();

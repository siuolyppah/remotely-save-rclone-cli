import { parse } from "https://deno.land/std@0.95.0/flags/mod.ts";
import { exists, ensureDir } from "https://deno.land/std@0.95.0/fs/mod.ts";
import {
  join,
  relative,
  dirname,
} from "https://deno.land/std@0.95.0/path/mod.ts";

async function processFile(
  filePath: string,
  targetFilePath: string,
  action: string,
  cipher: string,
  password: string,
) {
  const fileWorker = new Worker(
    new URL("./file_worker.ts", import.meta.url).href,
    { type: "module" },
  );
  const cryptoWorker = new Worker(
    new URL("./crypto_worker.ts", import.meta.url).href,
    { type: "module" },
  );

  fileWorker.postMessage({ type: "read", filePath });

  const fileContent: Uint8Array = await new Promise((resolve) => {
    fileWorker.onmessage = (e) => {
      resolve(e.data);
    };
  });

  cryptoWorker.postMessage({
    type: action,
    data: fileContent,
    cipher,
    password,
  });

  const result: Uint8Array = await new Promise((resolve) => {
    cryptoWorker.onmessage = (e) => {
      resolve(e.data);
    };
  });

  await ensureDir(dirname(targetFilePath));

  fileWorker.postMessage({
    type: "write",
    filePath: targetFilePath,
    data: result,
  });

  await new Promise((resolve) => {
    fileWorker.onmessage = (e) => {
      resolve(e.data);
    };
  });

  fileWorker.terminate();
  cryptoWorker.terminate();

  console.log(`File ${action}ed successfully. Saved to ${targetFilePath}`);
}

async function processDirectory(
  dirPath: string,
  targetDirPath: string,
  action: string,
  sourceRoot: string,
  cipher: string,
  password: string,
) {
  for await (const entry of Deno.readDir(dirPath)) {
    const sourcePath = join(dirPath, entry.name);
    let relativePath = relative(sourceRoot, sourcePath);
    if (action === "decrypt") {
      const cryptoWorker = new Worker(
        new URL("./crypto_worker.ts", import.meta.url).href,
        { type: "module" },
      );
      cryptoWorker.postMessage({
        type: "decryptPath",
        data: relativePath,
        cipher,
        password,
      });
      relativePath = await new Promise((resolve) => {
        cryptoWorker.onmessage = (e) => {
          resolve(e.data);
        };
      });
      cryptoWorker.terminate();
    }
    const targetPath = join(targetDirPath, relativePath);

    if (entry.isDirectory) {
      await ensureDir(targetPath);
      await processDirectory(
        sourcePath,
        targetDirPath,
        action,
        sourceRoot,
        cipher,
        password,
      );
    } else if (entry.isFile) {
      await processFile(sourcePath, targetPath, action, cipher, password);
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

  const sourceInfo = await Deno.stat(sourcePath);

  if (sourceInfo.isFile) {
    let finalTargetPath = targetFilePath;
    if (!targetFilePath) {
      const relativePath = relative(sourceRoot, sourcePath);
      const cryptoWorker = new Worker(
        new URL("./crypto_worker.ts", import.meta.url).href,
        { type: "module" },
      );
      cryptoWorker.postMessage({
        type: "decryptPath",
        data: relativePath,
        cipher: "base64",
        password,
      });
      const decryptedFileName = await new Promise((resolve) => {
        cryptoWorker.onmessage = (e) => {
          resolve(e.data);
        };
      });
      cryptoWorker.terminate();
      finalTargetPath = join(saveDir, decryptedFileName);
    }

    await processFile(sourcePath, finalTargetPath, action, "base64", password);
  } else if (sourceInfo.isDirectory) {
    if (!targetFilePath && saveDir) {
      await ensureDir(saveDir);
    }

    await processDirectory(
      sourcePath,
      saveDir,
      action,
      sourceRoot,
      "base64",
      password,
    );
  } else {
    console.error(
      "Invalid source path specified. It must be a file or directory.",
    );
    Deno.exit(1);
  }
}

await main();

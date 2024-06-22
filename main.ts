import { parse } from "https://deno.land/std@0.95.0/flags/mod.ts";
import { exists, ensureDir } from "https://deno.land/std@0.95.0/fs/mod.ts";
import {
  join,
  relative,
  dirname,
} from "https://deno.land/std@0.95.0/path/mod.ts";

interface Task {
  id: number;
  type: string;
  filePath?: string;
  data?: Uint8Array;
  targetPath?: string;
  cipher?: string;
  password?: string;
}

class WorkerPool {
  workers: Worker[];
  queue: Task[];
  busyWorkers: Set<Worker>;
  taskResolvers: Map<number, (value: any) => void>;
  currentTaskId: number;

  constructor(scriptPath: string, size: number) {
    this.workers = [];
    this.queue = [];
    this.busyWorkers = new Set();
    this.taskResolvers = new Map();
    this.currentTaskId = 0;

    for (let i = 0; i < size; i++) {
      const worker = new Worker(new URL(scriptPath, import.meta.url).href, {
        type: "module",
      });
      worker.onmessage = this.handleMessage.bind(this);
      this.workers.push(worker);
    }
  }

  handleMessage(e: MessageEvent) {
    const { id, result } = e.data;
    const worker = e.target as Worker;
    this.busyWorkers.delete(worker);

    if (this.taskResolvers.has(id)) {
      this.taskResolvers.get(id)(result);
      this.taskResolvers.delete(id);
    }

    if (this.queue.length > 0) {
      const task = this.queue.shift();
      this.assignTask(worker, task);
    }
  }

  assignTask(worker: Worker, task: Task) {
    this.busyWorkers.add(worker);
    worker.postMessage(task);
  }

  addTask(task: Task) {
    return new Promise((resolve) => {
      task.id = this.currentTaskId++;
      this.taskResolvers.set(task.id, resolve);

      const idleWorker = this.workers.find(
        (worker) => !this.busyWorkers.has(worker),
      );

      if (idleWorker) {
        this.assignTask(idleWorker, task);
      } else {
        this.queue.push(task);
      }
    });
  }

  terminate() {
    this.workers.forEach((worker) => worker.terminate());
  }
}

async function processFile(
  fileWorkerPool: WorkerPool,
  cryptoWorkerPool: WorkerPool,
  filePath: string,
  targetFilePath: string,
  action: string,
  cipher: string,
  password: string,
) {
  const fileContent: Uint8Array = await fileWorkerPool.addTask({
    type: "read",
    filePath,
  });
  const result: Uint8Array = await cryptoWorkerPool.addTask({
    type: action,
    data: fileContent,
    cipher,
    password,
  });
  await ensureDir(dirname(targetFilePath));
  await fileWorkerPool.addTask({
    type: "write",
    filePath: targetFilePath,
    data: result,
  });
  console.log(`File ${action}ed successfully. Saved to ${targetFilePath}`);
}

async function processDirectory(
  fileWorkerPool: WorkerPool,
  cryptoWorkerPool: WorkerPool,
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
      relativePath = await cryptoWorkerPool.addTask({
        type: "decryptPath",
        data: new TextEncoder().encode(relativePath),
        cipher,
        password,
      });
    }
    const targetPath = join(targetDirPath, relativePath);

    if (entry.isDirectory) {
      await ensureDir(targetPath);
      await processDirectory(
        fileWorkerPool,
        cryptoWorkerPool,
        sourcePath,
        targetDirPath,
        action,
        sourceRoot,
        cipher,
        password,
      );
    } else if (entry.isFile) {
      await processFile(
        fileWorkerPool,
        cryptoWorkerPool,
        sourcePath,
        targetPath,
        action,
        cipher,
        password,
      );
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

  const fileWorkerPool = new WorkerPool("./file_worker.ts", 4);
  const cryptoWorkerPool = new WorkerPool("./crypto_worker.ts", 4);

  const sourceInfo = await Deno.stat(sourcePath);

  if (sourceInfo.isFile) {
    let finalTargetPath = targetFilePath;
    if (!targetFilePath) {
      const relativePath = relative(sourceRoot, sourcePath);
      const decryptedFileName = await cryptoWorkerPool.addTask({
        type: "decryptPath",
        data: new TextEncoder().encode(relativePath),
        cipher: "base64",
        password,
      });
      finalTargetPath = join(saveDir, decryptedFileName);
    }

    await processFile(
      fileWorkerPool,
      cryptoWorkerPool,
      sourcePath,
      finalTargetPath,
      action,
      "base64",
      password,
    );
  } else if (sourceInfo.isDirectory) {
    if (!targetFilePath && saveDir) {
      await ensureDir(saveDir);
    }

    await processDirectory(
      fileWorkerPool,
      cryptoWorkerPool,
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

  fileWorkerPool.terminate();
  cryptoWorkerPool.terminate();
}

await main();

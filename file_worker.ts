self.onmessage = async (e) => {
  const { id, type, filePath, data } = e.data;

  if (type === "read") {
    const fileContent = new Uint8Array(await Deno.readFile(filePath));
    self.postMessage({ id, result: fileContent });
  } else if (type === "write") {
    await Deno.writeFile(filePath, data);
    self.postMessage({ id, result: { status: "done" } });
  }
};

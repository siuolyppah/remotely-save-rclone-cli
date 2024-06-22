self.onmessage = async (e) => {
  const { type, filePath, data } = e.data;

  if (type === "read") {
    const fileContent = new Uint8Array(await Deno.readFile(filePath));
    self.postMessage(fileContent);
  } else if (type === "write") {
    await Deno.writeFile(filePath, data);
    self.postMessage({ status: "done" });
  }
};

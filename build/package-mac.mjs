if (process.platform !== "darwin") throw Error("Run package:mac on macOS.");
await import("./package.mjs");

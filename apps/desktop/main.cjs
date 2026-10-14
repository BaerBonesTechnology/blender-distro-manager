const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("node:path");
let library, window;
app.whenReady().then(async () => {
  const { Library } = await import("../../packages/core/library.js");
  library = new Library(path.join(app.getPath("userData"), "library"));
  window = new BrowserWindow({
    width: 1150,
    height: 820,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (e) => e.preventDefault());
  window.webContents.session.setPermissionRequestHandler(
    (webContents, permission, callback) => callback(false),
  );
  const handle = (name, fn) =>
    ipcMain.handle(name, async (event, ...args) => {
      if (
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        throw Error("Unknown sender");
      return fn(...args);
    });
  handle("library", () => library.read());
  handle("import-install", async (name) => {
    const result = await dialog.showOpenDialog(window, {
      title: "Select Blender executable (inside the app bundle on macOS)",
      properties: ["openFile", "treatPackageAsDirectory"],
    });
    if (!result.canceled)
      return library.importInstall({ name, executable: result.filePaths[0] });
  });
  handle("import-addon", async () => {
    const result = await dialog.showOpenDialog(window, {
      title: "Select a trusted pure-Python legacy add-on folder",
      properties: ["openDirectory"],
    });
    if (!result.canceled) return library.importAddon(result.filePaths[0]);
  });
  handle("share", (install, addon) => library.share(install, addon));
  handle("launch", (id) => library.launch(id));
  window.loadFile(path.join(__dirname, "index.html"));
});
app.on("window-all-closed", () => app.quit());

const { app, BrowserWindow, ipcMain, dialog, net } = require("electron");
const path = require("node:path");
app.setName("Blender Distro Manager");
app.setPath(
  "userData",
  path.join(app.getPath("appData"), "blender-distro-manager"),
);
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
  const { catalog } = await import("../../packages/core/catalog.js");
  handle("catalog", () => catalog);
  const { discover } = await import("../../packages/core/releases.js");
  const { install } = await import("../../packages/core/installer.js");
  const releases = new Map();
  let downloadController;
  handle("release", async (id) => {
    const release = await discover(id, { fetcher: net.fetch });
    releases.set(id, release);
    return release;
  });
  handle("install", async (id) => {
    if (downloadController)
      throw Error("An installation is already in progress.");
    const release = releases.get(id);
    if (!release) throw Error("Load release information first.");
    downloadController = new AbortController();
    let lastProgress = 0;
    try {
      return await install(release, library, {
        fetcher: net.fetch,
        signal: downloadController.signal,
        onProgress: (progress) => {
          const now = Date.now();
          if (progress.phase === "Downloading" && now - lastProgress < 150)
            return;
          lastProgress = now;
          if (!window.isDestroyed())
            window.webContents.send("install-progress", { id, ...progress });
        },
      });
    } finally {
      downloadController = null;
    }
  });
  handle("cancel-install", () => downloadController?.abort());
  app.on("before-quit", () => downloadController?.abort());
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

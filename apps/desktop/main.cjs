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
  const { listReleases, resolveRelease } =
    await import("../../packages/core/releases.js");
  const { install } = await import("../../packages/core/installer.js");
  const releases = new Map();
  let downloadController;
  handle("releases", async (id, channel) => {
    const list = await listReleases(id, { fetcher: net.fetch, channel });
    for (const release of list) releases.set(release.url, release);
    return list;
  });
  handle("install", async (id, url) => {
    if (downloadController)
      throw Error("An installation is already in progress.");
    const selected = releases.get(url);
    if (!selected || selected.id !== id)
      throw Error("Select a release from the list first.");
    downloadController = new AbortController();
    let lastProgress = 0;
    try {
      const release = await resolveRelease(selected, net.fetch);
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
  handle("library", () => library.syncSharedAddons());
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
  const { fetchCatalog, installExtension } =
    await import("../../packages/core/extensions.js");
  let extensionCatalog = [],
    catalogTime = 0;
  handle("search-addons", async (query) => {
    if (typeof query !== "string" || query.length > 200)
      throw Error("Invalid search.");
    if (Date.now() - catalogTime > 5 * 60 * 1000) {
      extensionCatalog = await fetchCatalog(net.fetch);
      catalogTime = Date.now();
    }
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const matches = extensionCatalog.filter((a) =>
      terms.every((term) =>
        [a.name, a.tagline, a.maintainer, ...(a.tags || [])]
          .join(" ")
          .toLowerCase()
          .includes(term),
      ),
    );
    return { total: matches.length, items: matches.slice(0, 60) };
  });
  let addonInstalling = false;
  handle("install-community-addon", async (key) => {
    if (addonInstalling)
      throw Error("An add-on installation is already in progress.");
    const entry = extensionCatalog.find((a) => a.key === key);
    if (!entry) throw Error("Search for this add-on again.");
    addonInstalling = true;
    try {
      return await installExtension(entry, library, net.fetch);
    } finally {
      addonInstalling = false;
    }
  });
  handle("launch", (id) => library.launch(id));
  window.loadFile(path.join(__dirname, "index.html"));
});
app.on("window-all-closed", () => app.quit());

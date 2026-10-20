const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  net,
  shell,
  Menu,
} = require("electron");
const path = require("node:path");
app.setName("Blender Distro Manager");
app.setPath(
  "userData",
  (!app.isPackaged && process.env.BDM_DATA_DIR) ||
    path.join(app.getPath("appData"), "blender-distro-manager"),
);
let library, window;
app.whenReady().then(async () => {
  const { Library } = await import("../../packages/core/library.js");
  library = new Library(path.join(app.getPath("userData"), "library"));
  if (process.platform === "darwin")
    app.dock.setIcon(path.join(__dirname, "assets", "app-icon.png"));
  window = new BrowserWindow({
    icon: path.join(__dirname, "assets", "app-icon.png"),
    width: 1150,
    height: 820,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const openSettings = () => {
    if (!window.isDestroyed()) {
      window.show();
      window.webContents.send("open-settings");
    }
  };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
      {
        label: "File",
        submenu: [
          {
            label: "Settings…",
            accelerator: "CmdOrCtrl+,",
            click: openSettings,
          },
          { type: "separator" },
          { role: process.platform === "darwin" ? "close" : "quit" },
        ],
      },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );
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
  handle("settings-info", async () => {
    const state = await library.read();
    return {
      version: require("../../package.json").version,
      libraryPath: library.root,
      lastScan: state.discoveryCompletedAt || null,
    };
  });
  handle("open-library-folder", async () => {
    await require("node:fs/promises").mkdir(library.root, { recursive: true });
    const error = await shell.openPath(library.root);
    if (error) throw Error(error);
  });
  const { catalog } = await import("../../packages/core/catalog.js");
  handle("catalog", () =>
    catalog.map((item) => ({
      ...item,
      externalInstaller: item.id === "mixar" && process.platform === "win32",
    })),
  );
  handle("distribution-website", async (id) => {
    const item = catalog.find((item) => item.id === id);
    if (!item) throw Error("Unknown distribution.");
    await shell.openExternal(item.url + (id === "mixar" ? "/releases" : ""));
  });
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
    await detection;
    const existing = (await library.read()).installs.filter(
      (i) => i.external && i.distro === id,
    );
    if (existing.length) {
      const choice = await dialog.showMessageBox(window, {
        type: "question",
        buttons: ["Use existing installation", "Install another copy"],
        defaultId: 0,
        cancelId: 0,
        message: `${existing.map((i) => i.name).join(", ")} is already installed.`,
        detail:
          "It is available in Installed. Only continue if you want another side-by-side version.",
      });
      if (choice.response !== 1)
        throw Error("Use your existing build in Installed.");
    }
    downloadController = new AbortController();
    let lastProgress = 0;
    try {
      const release = await resolveRelease(selected, net.fetch);
      const installed = await install(release, library, {
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
      await library.syncApplications();
      return installed;
    } finally {
      downloadController = null;
    }
  });
  handle("cancel-install", () => downloadController?.abort());
  app.on("before-quit", () => downloadController?.abort());
  let detection = library.initialize();
  handle("library", async () => {
    await detection;
    const applicationReports = await library.syncApplications();
    const state = await library.syncSharedAddons();
    state.nativeReports = await library.syncNativeAddons();
    state.applicationReports = applicationReports;
    return state;
  });
  handle("scan-installations", async () => {
    detection = library.detect();
    return detection;
  });
  handle("locate-installation", async () => {
    const choice = await dialog.showOpenDialog(window, {
      title: "Locate an existing Blender, Kitchen 3D, or Mixar installation",
      properties: ["openDirectory"],
    });
    if (!choice.canceled) {
      const path = require("node:path");
      await library.detect([
        choice.filePaths[0].endsWith(".app")
          ? path.dirname(choice.filePaths[0])
          : choice.filePaths[0],
      ]);
    }
  });
  handle("set-addon-enabled", async (addon, install, enabled) => {
    await library.setEnabled(addon, install, enabled);
    await library.syncNativeAddons();
  });
  handle("remove-addon", async (id) => {
    const addon = (await library.read()).addons.find((a) => a.id === id);
    if (!addon) throw Error("Unknown add-on.");
    const response = await dialog.showMessageBox(window, {
      type: "question",
      buttons: ["Cancel", "Uninstall"],
      defaultId: 0,
      cancelId: 0,
      message: `Uninstall ${addon.name || addon.module}?`,
      detail:
        "Removes this add-on from the shared library and all managed profiles. Close running Blender instances first.",
    });
    if (response.response === 1) await library.removeAddon(id);
  });
  handle("uninstall-build", async (id) => {
    const install = (await library.read()).installs.find((i) => i.id === id);
    if (!install) throw Error("Unknown installation.");
    const target = await library.uninstallTarget(id);
    const response = await dialog.showMessageBox(window, {
      type: "question",
      buttons: ["Cancel", target ? "Uninstall" : "Remove from manager"],
      defaultId: 0,
      cancelId: 0,
      message: `${target ? "Uninstall" : "Remove"} ${install.name}?`,
      detail: target
        ? `Move ${target} to Trash and remove its manager profile. Close this build first. Project files and original user preferences outside the installation are preserved.`
        : "This system-managed executable must be uninstalled using your OS package manager. This removes its manager profile only.",
    });
    if (response.response === 1) {
      if (target) await shell.trashItem(target);
      await library.forgetInstall(id);
    }
  });
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

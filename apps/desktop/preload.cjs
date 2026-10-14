const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("manager", {
  searchAddons: (query) => ipcRenderer.invoke("search-addons", query),
  installCommunityAddon: (key) =>
    ipcRenderer.invoke("install-community-addon", key),
  scanInstallations: () => ipcRenderer.invoke("scan-installations"),
  locateInstallation: () => ipcRenderer.invoke("locate-installation"),
  setAddonEnabled: (addon, install, enabled) =>
    ipcRenderer.invoke("set-addon-enabled", addon, install, enabled),
  removeAddon: (id) => ipcRenderer.invoke("remove-addon", id),
  uninstallBuild: (id) => ipcRenderer.invoke("uninstall-build", id),
  catalog: () => ipcRenderer.invoke("catalog"),
  releases: (id, channel) => ipcRenderer.invoke("releases", id, channel),
  install: (id, url) => ipcRenderer.invoke("install", id, url),
  cancelInstall: () => ipcRenderer.invoke("cancel-install"),
  onProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("install-progress", listener);
    return () => ipcRenderer.removeListener("install-progress", listener);
  },
  read: () => ipcRenderer.invoke("library"),
  importInstall: (name) => ipcRenderer.invoke("import-install", name),
  importAddon: () => ipcRenderer.invoke("import-addon"),
  launch: (id) => ipcRenderer.invoke("launch", id),
});

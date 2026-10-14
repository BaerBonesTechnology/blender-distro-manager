const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("manager", {
  searchAddons: (query) => ipcRenderer.invoke("search-addons", query),
  installCommunityAddon: (key) =>
    ipcRenderer.invoke("install-community-addon", key),
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

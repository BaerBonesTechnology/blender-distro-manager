const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("manager", {
  catalog: () => ipcRenderer.invoke("catalog"),
  release: (id) => ipcRenderer.invoke("release", id),
  install: (id) => ipcRenderer.invoke("install", id),
  cancelInstall: () => ipcRenderer.invoke("cancel-install"),
  onProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("install-progress", listener);
    return () => ipcRenderer.removeListener("install-progress", listener);
  },
  read: () => ipcRenderer.invoke("library"),
  importInstall: (name) => ipcRenderer.invoke("import-install", name),
  importAddon: () => ipcRenderer.invoke("import-addon"),
  share: (install, addon) => ipcRenderer.invoke("share", install, addon),
  launch: (id) => ipcRenderer.invoke("launch", id),
});

const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("manager", {
  read: () => ipcRenderer.invoke("library"),
  importInstall: (name) => ipcRenderer.invoke("import-install", name),
  importAddon: () => ipcRenderer.invoke("import-addon"),
  share: (install, addon) => ipcRenderer.invoke("share", install, addon),
  launch: (id) => ipcRenderer.invoke("launch", id),
});

const status = document.querySelector("#status");
async function act(fn) {
  try {
    status.textContent = "Working…";
    await fn();
    await refresh();
    status.textContent = "Done.";
  } catch (e) {
    status.textContent = e.message;
  }
}
document.querySelector("#import").onclick = () =>
  act(() =>
    window.manager.importInstall(document.querySelector("#name").value),
  );
document.querySelector("#addon").onclick = () =>
  act(() => window.manager.importAddon());
async function refresh() {
  const state = await window.manager.read();
  for (const key of ["installs", "addons"]) {
    const root = document.querySelector("#" + key);
    root.replaceChildren();
    if (!state[key].length)
      root.textContent =
        key === "installs"
          ? "No builds imported yet."
          : "No add-ons imported yet.";
    for (const item of state[key]) {
      const card = document.createElement("article");
      card.className = "card";
      const title = document.createElement("h3");
      title.textContent = item.name || item.module;
      card.append(title);
      if (key === "installs") {
        const button = document.createElement("button");
        button.textContent = "Launch →";
        button.onclick = () => act(() => window.manager.launch(item.id));
        card.append(button);
      } else {
        const label = document.createElement("label");
        label.textContent = "Assign to build";
        const select = document.createElement("select");
        for (const install of state.installs) {
          const option = document.createElement("option");
          option.value = install.id;
          option.textContent = install.name;
          select.append(option);
        }
        label.append(select);
        const button = document.createElement("button");
        button.textContent = "Share add-on";
        button.disabled = !state.installs.length;
        button.onclick = () =>
          act(() => window.manager.share(select.value, item.id));
        card.append(label, document.createElement("br"), button);
      }
      root.append(card);
    }
  }
}
refresh().catch((e) => (status.textContent = e.message));

const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab) {
  for (const candidate of tabs) {
    const active = candidate === tab;
    candidate.setAttribute("aria-selected", String(active));
    candidate.tabIndex = active ? 0 : -1;
    document.getElementById(candidate.getAttribute("aria-controls")).hidden =
      !active;
  }
  status.textContent = "";
}
tabs.forEach((tab, index) => {
  tab.onclick = () => selectTab(tab);
  tab.onkeydown = (event) => {
    let next;
    if (event.key === "ArrowRight") next = tabs[(index + 1) % tabs.length];
    if (event.key === "ArrowLeft")
      next = tabs[(index + tabs.length - 1) % tabs.length];
    if (event.key === "Home") next = tabs[0];
    if (event.key === "End") next = tabs.at(-1);
    if (next) {
      event.preventDefault();
      selectTab(next);
      next.focus();
    }
  };
});

let installing = false;
const downloadCards = new Map();
const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1) + " MB";
window.manager.onProgress((progress) => {
  const card = downloadCards.get(progress.id);
  if (!card) return;
  card.message.textContent =
    progress.phase === "Downloading"
      ? `Downloading ${mb(progress.received)}${progress.total ? " / " + mb(progress.total) : ""}`
      : progress.phase;
  if (progress.total) {
    card.progress.max = progress.total;
    card.progress.value = progress.received;
  } else card.progress.removeAttribute("value");
});
window.manager
  .catalog()
  .then(async (items) => {
    for (const item of items) {
      const card = document.createElement("article");
      card.className = "card";
      const title = document.createElement("h3");
      title.textContent = item.name;
      const detail = document.createElement("p");
      detail.textContent = "Looking up releases…";
      const button = document.createElement("button");
      button.textContent = "Download and install";
      button.disabled = true;
      const cancel = document.createElement("button");
      cancel.textContent = "Cancel";
      cancel.className = "secondary";
      cancel.hidden = true;
      const progress = document.createElement("progress");
      progress.hidden = true;
      progress.setAttribute("aria-label", item.name + " download progress");
      const message = document.createElement("p");
      message.setAttribute("role", "status");
      const actions = document.createElement("div");
      actions.className = "actions";
      actions.append(button, cancel);
      card.append(title, detail, actions, progress, message);
      document.querySelector("#catalog").append(card);
      const view = { message, progress, button };
      downloadCards.set(item.id, view);
      let release;
      const load = async () => {
        button.disabled = true;
        try {
          release = await window.manager.release(item.id);
          detail.textContent = `${release.version} · ${release.channel} · ${release.platform} ${release.arch}`;
          button.textContent = "Download and install";
        } catch (e) {
          detail.textContent = e.message;
          button.textContent = "Retry release lookup";
        } finally {
          button.disabled = installing;
        }
      };
      cancel.onclick = async () => {
        cancel.disabled = true;
        message.textContent = "Canceling…";
        await window.manager.cancelInstall();
      };
      button.onclick = async () => {
        if (!release) {
          await load();
          return;
        }
        if (installing) return;
        installing = true;
        for (const v of downloadCards.values()) v.button.disabled = true;
        progress.hidden = false;
        cancel.hidden = false;
        cancel.disabled = false;
        try {
          await window.manager.install(item.id);
          message.textContent = "Installed. Ready to launch from Installed.";
          await refresh();
        } catch (e) {
          message.textContent = e.message;
        } finally {
          installing = false;
          progress.hidden = true;
          cancel.hidden = true;
          for (const v of downloadCards.values()) v.button.disabled = false;
        }
      };
      void load();
    }
  })
  .catch((e) => (status.textContent = e.message));

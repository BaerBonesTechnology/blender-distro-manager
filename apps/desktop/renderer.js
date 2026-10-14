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

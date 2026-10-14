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
          ? "No builds installed yet. Choose a build in Download to get started."
          : "No add-ons in your shared library yet.";
    for (const item of state[key]) {
      const card = document.createElement("article");
      card.className = "card";
      const title = document.createElement("h3");
      title.textContent = item.name || item.module;
      card.append(title);
      if (item.version && key === "addons") {
        const version = document.createElement("p");
        version.textContent = `Version ${item.version} · Blender ${item.manifest?.blender_version_min || "unknown"}+`;
        card.append(version);
      }
      if (key === "installs") {
        const button = document.createElement("button");
        button.textContent = "Launch →";
        button.onclick = () => act(() => window.manager.launch(item.id));
        const location = document.createElement("p");
        location.className = "small";
        location.textContent = `${item.external ? "Existing installation" : "Downloaded by manager"} · ${item.executable}`;
        const remove = document.createElement("button");
        remove.className = "secondary";
        remove.textContent = "Uninstall";
        remove.onclick = () =>
          act(() => window.manager.uninstallBuild(item.id));
        const actions = document.createElement("div");
        actions.className = "actions";
        actions.append(button, remove);
        card.append(location, actions);
        for (const message of state.applicationReports?.[item.id] || []) {
          const warning = document.createElement("p");
          warning.textContent = message;
          card.append(warning);
        }
      } else {
        const availability = state.availability?.[item.id];
        const menu = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = "Enabled in";
        menu.append(summary);
        for (const install of state.installs) {
          const problem = availability?.skipped.find(
            (s) => s.name === install.name,
          );
          const label = document.createElement("label");
          label.className = "check-row";
          const check = document.createElement("input");
          check.type = "checkbox";
          check.checked = !problem && !item.disabledIn?.includes(install.id);
          check.disabled = !!problem;
          const text = document.createElement("span");
          text.textContent =
            install.name + (problem ? " — " + problem.reason : "");
          label.append(check, text);
          menu.append(label);
          check.onchange = async () => {
            const enabled = check.checked;
            check.disabled = true;
            status.textContent = "Saving…";
            try {
              await window.manager.setAddonEnabled(
                item.id,
                install.id,
                enabled,
              );
              status.textContent = "Saved. Applies to direct launches too.";
            } catch (e) {
              check.checked = !enabled;
              status.textContent = e.message;
            } finally {
              check.disabled = false;
            }
          };
        }
        const note = document.createElement("p");
        note.className = "small";
        note.textContent =
          "New compatible builds are enabled automatically. Changes take effect on the next launch, including opening the app directly.";
        const remove = document.createElement("button");
        remove.className = "secondary";
        remove.textContent = "Uninstall add-on";
        remove.onclick = () => act(() => window.manager.removeAddon(item.id));
        card.append(menu, note, remove);
        for (const build of state.installs) {
          for (const report of state.nativeReports?.[build.id] || []) {
            if (!report.addonId || report.addonId === item.id) {
              const warning = document.createElement("p");
              warning.textContent = `${build.name}: ${report.reason}`;
              card.append(warning);
            }
          }
        }
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
      const channelLabel = document.createElement("label");
      channelLabel.textContent = "Channel";
      const channel = document.createElement("select");
      channel.setAttribute("aria-label", item.name + " channel");
      for (const value of item.id === "blender"
        ? ["Stable", "Beta", "Alpha"]
        : ["All", "Stable", "Pre-release", "Beta", "Alpha"]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        channel.append(option);
      }
      channelLabel.append(channel);
      const versionLabel = document.createElement("label");
      versionLabel.textContent = "Version";
      const version = document.createElement("select");
      version.setAttribute("aria-label", item.name + " version");
      versionLabel.append(version);
      card.append(
        title,
        channelLabel,
        versionLabel,
        detail,
        actions,
        progress,
        message,
      );
      document.querySelector("#catalog").append(card);
      let list = [],
        loading = false,
        failed = false;
      const selected = () => list.find((r) => r.url === version.value);
      const update = () => {
        const release = selected();
        button.disabled = installing || loading || (!release && !failed);
        channel.disabled = installing || loading;
        version.disabled = installing || loading || !list.length;
        detail.textContent = release
          ? `${release.channel} · ${release.platform} ${release.arch}${release.channel === "Beta" || release.channel === "Alpha" ? " · Development build" : ""}`
          : loading
            ? "Looking up releases…"
            : failed
              ? detail.textContent
              : "No builds published for this channel and computer.";
      };
      const view = { message, progress, button, update };
      downloadCards.set(item.id, view);
      const load = async () => {
        loading = true;
        failed = false;
        list = [];
        version.replaceChildren();
        update();
        try {
          list = await window.manager.releases(item.id, channel.value);
          for (const release of list) {
            const option = document.createElement("option");
            option.value = release.url;
            option.textContent = `${release.version}${release.date ? " · " + release.date : ""} · ${release.channel}`;
            version.append(option);
          }
          button.textContent = "Download and install";
        } catch (e) {
          failed = true;
          detail.textContent = e.message;
          button.textContent = "Retry release lookup";
        } finally {
          loading = false;
          update();
        }
      };
      channel.onchange = () => void load();
      version.onchange = update;
      cancel.onclick = async () => {
        cancel.disabled = true;
        message.textContent = "Canceling…";
        await window.manager.cancelInstall();
      };
      button.onclick = async () => {
        if (!selected()) {
          await load();
          return;
        }
        if (installing) return;
        installing = true;
        for (const v of downloadCards.values()) v.update();
        progress.hidden = false;
        cancel.hidden = false;
        cancel.disabled = false;
        try {
          await window.manager.install(item.id, selected().url);
          message.textContent = "Installed. Ready to launch from Installed.";
          await refresh();
        } catch (e) {
          message.textContent = e.message;
        } finally {
          installing = false;
          progress.hidden = true;
          cancel.hidden = true;
          for (const v of downloadCards.values()) v.update();
        }
      };
      void load();
    }
  })
  .catch((e) => (status.textContent = e.message));

let addonSearchSequence = 0;
let addonBusy = false;
async function searchAddons() {
  const sequence = ++addonSearchSequence;
  const output = document.querySelector("#addon-results");
  const summary = document.querySelector("#addon-search-status");
  summary.textContent = "Searching Blender Extensions…";
  try {
    const result = await window.manager.searchAddons(
      document.querySelector("#addon-query").value,
    );
    if (sequence !== addonSearchSequence) return;
    const library = await window.manager.read();
    output.replaceChildren();
    summary.textContent = result.total
      ? `${result.total} add-ons found${result.total > 60 ? " · Showing the first 60. Refine your search for more." : ""}`
      : "No matching add-ons.";
    for (const entry of result.items) {
      const card = document.createElement("article");
      card.className = "card";
      const title = document.createElement("h3");
      title.textContent = entry.name;
      const text = document.createElement("p");
      text.textContent = entry.tagline;
      const info = document.createElement("p");
      info.className = "small";
      info.textContent = `${entry.version} · ${entry.maintainer} · Blender ${entry.blender_version_min}+${entry.blender_version_max ? " (before " + entry.blender_version_max + ")" : ""}`;
      const permissions = document.createElement("p");
      permissions.className = "small";
      permissions.textContent = entry.permissions
        ? Object.entries(entry.permissions)
            .map(([key, value]) => `${key}: ${value}`)
            .join(" · ")
        : "";
      const button = document.createElement("button");
      const installed = library.addons.some(
        (a) => a.archiveHash === entry.archive_hash,
      );
      button.textContent = installed
        ? "In shared library"
        : "Install to library";
      button.disabled = installed;
      const message = document.createElement("p");
      message.setAttribute("role", "status");
      button.onclick = async () => {
        if (addonBusy) {
          message.textContent = "Wait for the current add-on installation.";
          return;
        }
        addonBusy = true;
        button.disabled = true;
        message.textContent = "Downloading and verifying…";
        try {
          await window.manager.installCommunityAddon(entry.key);
          button.textContent = "In shared library";
          message.textContent =
            "Installed in the shared library. Available to compatible builds automatically.";
          await refresh();
        } catch (e) {
          message.textContent = e.message;
          button.disabled = false;
        } finally {
          addonBusy = false;
        }
      };
      card.append(title, text, info, permissions, button, message);
      output.append(card);
    }
  } catch (e) {
    if (sequence === addonSearchSequence) {
      output.replaceChildren();
      summary.textContent = e.message;
    }
  }
}
document.querySelector("#addon-search").onsubmit = (e) => {
  e.preventDefault();
  void searchAddons();
};
document.querySelector("#tab-addons").addEventListener("click", () => {
  if (!addonSearchSequence) void searchAddons();
});

document.querySelector("#scan-builds").onclick = () =>
  act(() => window.manager.scanInstallations());
document.querySelector("#locate-build").onclick = () =>
  act(() => window.manager.locateInstallation());

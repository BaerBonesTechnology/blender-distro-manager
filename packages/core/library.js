import fs from "node:fs/promises";
import { addApplication, removeApplication } from "./applications.js";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { syncNative, nativeEnv } from "./native-integration.js";
import { compatible } from "./extensions.js";
import { detectInstallations } from "./detection.js";
import { execFile, spawn } from "node:child_process";
export class Library {
  constructor(root, { scanner = detectInstallations } = {}) {
    this.scanner = scanner;
    this.root = path.resolve(root);
    this.queue = Promise.resolve();
    this.syncQueue = Promise.resolve();
  }
  async read() {
    try {
      return JSON.parse(
        await fs.readFile(path.join(this.root, "library.json"), "utf8"),
      );
    } catch (e) {
      if (e.code === "ENOENT") return { installs: [], addons: [] };
      throw e;
    }
  }
  update(fn) {
    const job = this.queue.then(async () => {
      await fs.mkdir(this.root, { recursive: true });
      const state = await this.read();
      const result = await fn(state);
      const target = path.join(this.root, "library.json");
      await fs.writeFile(target + ".tmp", JSON.stringify(state, null, 2));
      await fs.rename(target + ".tmp", target);
      return result;
    });
    this.queue = job.catch(() => {});
    return job;
  }
  async importInstall({ name, executable }) {
    if (typeof name !== "string" || !name.trim() || name.length > 100)
      throw Error("Choose a name (1–100 characters).");
    const resolved = await fs.realpath(executable);
    if (!(await fs.stat(resolved)).isFile())
      throw Error("Select the Blender executable inside the installation.");
    return this.update((s) => {
      if (s.installs.some((i) => i.executable === resolved))
        throw Error("This installation is already managed.");
      const item = {
        id: randomUUID(),
        name: name.trim(),
        executable: resolved,
      };
      s.installs.push(item);
      return item;
    });
  }
  async importAddon(folder) {
    const source = await fs.realpath(folder);
    const id = path.basename(source);
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id))
      throw Error("Legacy add-on folder must be a valid Python module name.");
    await fs.access(path.join(source, "__init__.py"));
    const inspect = async (dir) => {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        if (e.isSymbolicLink())
          throw Error("Add-on folders cannot contain symbolic links.");
        if (/\.(whl|dll|so|pyd|dylib)$/i.test(e.name))
          throw Error(
            "This prototype supports pure-Python legacy add-ons only.",
          );
        if (e.isDirectory()) await inspect(path.join(dir, e.name));
      }
    };
    await inspect(source);
    return this.update(async (s) => {
      if (s.addons.some((a) => a.module === id))
        throw Error("This module is already in the library.");
      const key = randomUUID();
      const target = path.join(this.root, "addons", key, id);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.cp(source, target, { recursive: true });
      const item = { id: key, module: id, path: target };
      s.addons.push(item);
      return item;
    });
  }
  async share(
    installId,
    addonId,
    { automatic = false, version: knownVersion } = {},
  ) {
    const state = await this.read();
    const install = state.installs.find((i) => i.id === installId);
    const addon = state.addons.find((a) => a.id === addonId);
    if (!install || !addon) throw Error("Unknown installation or add-on.");
    if (addon.kind === "extension") {
      const { stdout } = knownVersion
        ? { stdout: `Blender ${knownVersion}` }
        : await promisify(execFile)(install.executable, ["--version"], {
            timeout: 20000,
          });
      const version = stdout.match(
        /(?:Blender|Kitchen\s*3D)\s+(\d+\.\d+\.\d+)/i,
      )?.[1];
      const problem = compatible(addon.manifest, version);
      if (problem) throw Error(problem);
    }
    const parent =
      addon.kind === "extension"
        ? path.join(this.root, "profiles", install.id, "extensions", "system")
        : path.join(this.root, "profiles", install.id, "scripts", "addons");
    await fs.mkdir(parent, { recursive: true });
    const dest = path.join(parent, addon.module);
    try {
      const existing = await fs.lstat(dest);
      if (
        automatic &&
        existing.isSymbolicLink() &&
        (await fs.realpath(dest)) === (await fs.realpath(addon.path))
      )
        return { module: addon.module };
      throw Error("Add-on already assigned.");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    await fs.symlink(
      addon.path,
      dest,
      process.platform === "win32" ? "junction" : "dir",
    );
    return { module: addon.module };
  }
  syncSharedAddons() {
    const job = this.syncQueue.then(async () => {
      const state = await this.read();
      const availability = Object.fromEntries(
        state.addons.map((a) => [a.id, { available: [], skipped: [] }]),
      );
      for (const install of state.installs) {
        let version, probeError;
        if (state.addons.some((a) => a.kind === "extension")) {
          try {
            const { stdout } = await promisify(execFile)(
              install.executable,
              ["--version"],
              { timeout: 20000 },
            );
            version = stdout.match(
              /(?:Blender|Kitchen\s*3D)\s+(\d+\.\d+\.\d+)/i,
            )?.[1];
            if (!version) throw Error("Could not determine Blender version.");
          } catch (e) {
            probeError = e.message;
          }
        }
        for (const addon of state.addons) {
          try {
            if (addon.kind === "extension" && probeError)
              throw Error(probeError);
            await this.share(install.id, addon.id, {
              automatic: true,
              version,
            });
            availability[addon.id].available.push(install.name);
          } catch (e) {
            availability[addon.id].skipped.push({
              name: install.name,
              reason: e.message,
            });
          }
        }
      }
      return { ...state, availability };
    });
    this.syncQueue = job.catch(() => {});
    return job;
  }
  async syncApplications(options) {
    const reports = {};
    await this.update(async (state) => {
      for (const install of state.installs) {
        try {
          const shortcut = await addApplication(install, options);
          if (shortcut) install.applicationShortcut = shortcut;
        } catch (error) {
          reports[install.id] = [error.message];
        }
      }
    });
    return reports;
  }
  initialize() {
    this.initialization ||= (async () => {
      const state = await this.read();
      if (state.discoveryCompletedAt) return;
      // Existing libraries already contain the user's saved choices.
      if (state.installs.length || state.ignoredExecutables?.length) {
        await this.update((s) => {
          s.discoveryCompletedAt = new Date().toISOString();
        });
        return;
      }
      await this.detect();
    })().catch((error) => {
      this.initialization = null;
      throw error;
    });
    return this.initialization;
  }
  async detect(roots) {
    const candidates = await this.scanner(roots);
    return this.update((state) => {
      for (const candidate of candidates) {
        if (
          state.installs.some((i) => i.executable === candidate.executable) ||
          (state.ignoredExecutables || []).includes(candidate.executable)
        )
          continue;
        state.installs.push({ ...candidate, id: randomUUID() });
      }
      state.discoveryCompletedAt = new Date().toISOString();
      return candidates.length;
    });
  }
  async setEnabled(addonId, installId, enabled) {
    if (typeof enabled !== "boolean") throw Error("Invalid enabled state.");
    await this.update((state) => {
      const addon = state.addons.find((a) => a.id === addonId);
      if (!addon || !state.installs.some((i) => i.id === installId))
        throw Error("Unknown add-on or build.");
      addon.disabledIn ||= [];
      addon.disabledIn = addon.disabledIn.filter((id) => id !== installId);
      if (!enabled) addon.disabledIn.push(installId);
    });
  }
  async removeAddon(id) {
    const state = await this.read();
    const addon = state.addons.find((a) => a.id === id);
    if (!addon) throw Error("Unknown add-on.");
    for (const install of state.installs) {
      const dest = path.join(
        this.root,
        "profiles",
        install.id,
        ...(addon.kind === "extension"
          ? ["extensions", "system"]
          : ["scripts", "addons"]),
        addon.module,
      );
      try {
        if (
          (await fs.lstat(dest)).isSymbolicLink() &&
          (await fs.realpath(dest)) === (await fs.realpath(addon.path))
        )
          await fs.unlink(dest);
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    }
    const owned = path.resolve(addon.path);
    if (
      ![
        path.join(this.root, "addons") + path.sep,
        path.join(this.root, "extensions") + path.sep,
      ].some((prefix) => owned.startsWith(prefix))
    )
      throw Error("Refusing to remove an unmanaged add-on folder.");
    await fs.rm(owned, { recursive: true, force: true });
    await this.update((s) => {
      s.addons = s.addons.filter((a) => a.id !== id);
    });
  }
  async uninstallTarget(id) {
    const state = await this.read();
    const install = state.installs.find((i) => i.id === id);
    if (!install) throw Error("Unknown installation.");
    if (install.external) return install.uninstallPath;
    const parent = path.join(this.root, "installations");
    const relative = path.relative(parent, install.executable);
    if (
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      relative.split(path.sep).length < 2
    )
      throw Error("Unmanaged installation path.");
    return path.join(parent, relative.split(path.sep)[0]);
  }
  async forgetInstall(id) {
    await this.update(async (state) => {
      const install = state.installs.find((i) => i.id === id);
      if (!install) throw Error("Unknown installation.");
      await removeApplication(install);
      state.ignoredExecutables ||= [];
      state.ignoredExecutables.push(install.executable);
      state.installs = state.installs.filter((i) => i.id !== id);
      for (const a of state.addons)
        a.disabledIn = a.disabledIn?.filter((i) => i !== id);
    });
    await fs.rm(path.join(this.root, "profiles", id), {
      recursive: true,
      force: true,
    });
  }
  async prepareLaunch(id) {
    const state = await this.syncSharedAddons();
    const install = state.installs.find((i) => i.id === id);
    if (!install) throw Error("Unknown installation.");
    const profile = path.join(this.root, "profiles", id);
    const config = path.join(profile, "config");
    if (install.external) {
      try {
        await fs.access(path.join(profile, "preferences-adopted"));
      } catch {
        // Ask the executable for its native config location, preserving distro-specific paths.
        const { stdout } = await promisify(execFile)(
          install.executable,
          [
            "--background",
            "--factory-startup",
            "--python-expr",
            'import bpy; print("BDM_CONFIG=" + bpy.utils.user_resource("CONFIG"))',
          ],
          { timeout: 60000 },
        );
        const native = stdout.match(/^BDM_CONFIG=(.+)$/m)?.[1]?.trim();
        if (native && path.resolve(native) !== path.resolve(config)) {
          try {
            await fs.cp(native, config, {
              recursive: true,
              force: false,
              errorOnExist: false,
            });
          } catch (e) {
            if (e.code !== "ENOENT") throw e;
          }
        }
        await fs.mkdir(config, { recursive: true });
        await fs.writeFile(path.join(profile, "preferences-adopted"), "1");
      }
    }
    await fs.mkdir(config, { recursive: true });
    await fs.mkdir(path.join(profile, "scripts", "addons"), {
      recursive: true,
    });
    await fs.mkdir(path.join(profile, "extensions", "system"), {
      recursive: true,
    });
    const enabled = state.addons
      .filter(
        (a) =>
          state.availability[a.id].available.includes(install.name) &&
          !a.disabledIn?.includes(id),
      )
      .map((a) =>
        a.kind === "extension" ? "bl_ext.system." + a.module : a.module,
      );
    const all = state.addons.map((a) =>
      a.kind === "extension" ? "bl_ext.system." + a.module : a.module,
    );
    const script = path.join(profile, "shared-addons.py");
    await fs.writeFile(
      script,
      `import addon_utils, bpy, json\nfrom bpy.app.handlers import persistent\nenabled = json.loads(${JSON.stringify(JSON.stringify(enabled))})\nmanaged = json.loads(${JSON.stringify(JSON.stringify(all))})\n@persistent\ndef apply_shared_addons(*args):\n    for module in managed:\n        try:\n            if module in enabled:\n                if not addon_utils.check(module)[1]:\n                    addon_utils.enable(module, default_set=True, persistent=True)\n            elif addon_utils.check(module)[1]:\n                addon_utils.disable(module, default_set=True)\n        except Exception as exc:\n            print('Shared add-on failed:', module, exc)\napply_shared_addons()\nbpy.app.handlers.load_post.append(apply_shared_addons)\n`,
    );
    return {
      install,
      script,
      env: {
        ...process.env,
        BLENDER_USER_CONFIG: config,
        BLENDER_SYSTEM_EXTENSIONS: path.join(profile, "extensions"),
        BLENDER_USER_SCRIPTS: path.join(profile, "scripts"),
      },
    };
  }
  syncNativeAddons() {
    const job = (this.nativeQueue || Promise.resolve()).then(() =>
      syncNative(this),
    );
    this.nativeQueue = job.catch(() => {});
    return job;
  }
  async launch(id) {
    const state = await this.read();
    const install = state.installs.find((i) => i.id === id);
    if (!install) throw Error("Unknown installation.");
    const reports = await this.syncNativeAddons();
    if (reports[id]?.length)
      throw Error(reports[id].map((r) => r.reason).join(" "));
    const env = nativeEnv();
    return new Promise((resolve, reject) => {
      const child = spawn(install.executable, [], {
        detached: true,
        stdio: "ignore",
        env,
      });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve({ launched: true });
      });
    });
  }
}

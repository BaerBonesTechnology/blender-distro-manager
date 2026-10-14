import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { compatible } from "./extensions.js";
import { execFile, spawn } from "node:child_process";
export class Library {
  constructor(root) {
    this.root = path.resolve(root);
    this.queue = Promise.resolve();
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
  async share(installId, addonId) {
    const state = await this.read();
    const install = state.installs.find((i) => i.id === installId);
    const addon = state.addons.find((a) => a.id === addonId);
    if (!install || !addon) throw Error("Unknown installation or add-on.");
    if (addon.kind === "extension") {
      const { stdout } = await promisify(execFile)(
        install.executable,
        ["--version"],
        { timeout: 20000 },
      );
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
      await fs.lstat(dest);
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
  async launch(id) {
    const state = await this.read();
    const install = state.installs.find((i) => i.id === id);
    if (!install) throw Error("Unknown installation.");
    const profile = path.join(this.root, "profiles", id);
    await fs.mkdir(path.join(profile, "config"), { recursive: true });
    await fs.mkdir(path.join(profile, "scripts", "addons"), {
      recursive: true,
    });
    await fs.mkdir(path.join(profile, "extensions", "system"), {
      recursive: true,
    });
    return new Promise((resolve, reject) => {
      const child = spawn(install.executable, [], {
        detached: true,
        stdio: "ignore",
        env: {
          ...process.env,
          BLENDER_USER_CONFIG: path.join(profile, "config"),
          BLENDER_SYSTEM_EXTENSIONS: path.join(profile, "extensions"),
          BLENDER_USER_SCRIPTS: path.join(profile, "scripts"),
        },
      });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve({ launched: true });
      });
    });
  }
}

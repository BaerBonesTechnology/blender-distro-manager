import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { compatible } from "./extensions.js";
const run = promisify(execFile);
export function nativeEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (key.startsWith("BLENDER_USER_") || key === "BLENDER_SYSTEM_EXTENSIONS")
      delete env[key];
  return env;
}
export async function probeNative(executable) {
  const expr = `import bpy,json; print('BDM_NATIVE='+json.dumps({'scripts':bpy.utils.user_resource('SCRIPTS',create=True),'config':bpy.utils.user_resource('CONFIG',create=True),'extensions':next((r.directory for r in bpy.context.preferences.extensions.repos if r.module=='user_default' and r.enabled),None) if hasattr(bpy.context.preferences,'extensions') else None,'version':'.'.join(map(str,bpy.app.version))}))`;
  const { stdout } = await run(
    executable,
    ["--background", "--python-exit-code", "1", "--python-expr", expr],
    { env: nativeEnv(), timeout: 60000, maxBuffer: 4 * 1024 ** 2 },
  );
  const line = stdout.match(/^BDM_NATIVE=(.+)$/m);
  if (!line) throw Error("Could not locate native Blender add-on directories.");
  return JSON.parse(line[1]);
}
async function readJSON(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
}
async function writeJSON(file, value) {
  await fs.writeFile(file + ".tmp", JSON.stringify(value, null, 2));
  await fs.rename(file + ".tmp", file);
}
export async function syncNative(library, { probe = probeNative } = {}) {
  const state = await library.read();
  const stateFile = path.join(library.root, "native-addons.json");
  const ledgerFile = path.join(library.root, "native-links.json");
  const previous = await readJSON(ledgerFile, []);
  const settings = await readJSON(stateFile, {});
  const wanted = [];
  const reports = {};
  for (const executable of Object.keys(settings))
    if (!state.installs.some((i) => i.executable === executable))
      settings[executable] = settings[executable].map((item) => ({
        ...item,
        enabled: false,
      }));
  const bridgeSource = await fs.readFile(
    new URL("./scripts/native_startup.py", import.meta.url),
    "utf8",
  );
  library.nativeCache ||= new Map();
  for (const install of state.installs) {
    try {
      const executable = await fs.realpath(install.executable);
      let native = library.nativeCache.get(executable);
      if (!native) {
        native = await probe(executable);
        library.nativeCache.set(executable, native);
      }
      if (!path.isAbsolute(native.scripts))
        throw Error("Blender returned an invalid scripts directory.");
      const startup = path.join(native.scripts, "startup");
      await fs.mkdir(startup, { recursive: true });
      const bridge = path.join(startup, "bdm_shared_library.py");
      const content = bridgeSource.replace(
        "__BDM_STATE_FILE__",
        JSON.stringify(stateFile),
      );
      try {
        const existing = await fs.readFile(bridge, "utf8");
        if (
          !existing.startsWith(
            "# Blender Distro Manager shared-library bridge.",
          ) ||
          !existing.includes(JSON.stringify(stateFile))
        )
          throw Error(
            "A different shared-library bridge already uses this scripts directory.",
          );
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      await fs.writeFile(bridge + ".tmp", content);
      await fs.rename(bridge + ".tmp", bridge);
      const managed = new Map(
        (settings[executable] || []).map((item) => [
          item.module,
          { ...item, enabled: false },
        ]),
      );
      reports[install.id] = [];
      for (const addon of state.addons) {
        const module =
          addon.kind === "extension"
            ? "bl_ext.user_default." + addon.module
            : addon.module;
        try {
          const problem =
            addon.kind === "extension"
              ? compatible(addon.manifest, native.version)
              : null;
          if (problem) throw Error(problem);
          if (addon.kind === "extension" && !native.extensions)
            throw Error(
              "Enable the User Default extension repository in this build.",
            );
          const parent =
            addon.kind === "extension"
              ? native.extensions
              : path.join(native.scripts, "addons");
          await fs.mkdir(parent, { recursive: true });
          const dest = path.join(parent, addon.module);
          const target = await fs.realpath(addon.path);
          try {
            const existing = await fs.lstat(dest);
            if (
              !existing.isSymbolicLink() ||
              (await fs.realpath(dest)) !== target
            )
              throw Error(
                "An independently installed add-on already occupies this path.",
              );
          } catch (e) {
            if (e.code !== "ENOENT") throw e;
            await fs.symlink(
              target,
              dest,
              process.platform === "win32" ? "junction" : "dir",
            );
          }
          wanted.push({ dest, target, installId: install.id });
          managed.set(module, {
            module,
            enabled: !addon.disabledIn?.includes(install.id),
          });
        } catch (e) {
          if (managed.has(module))
            managed.set(module, { module, enabled: false });
          reports[install.id].push({ addonId: addon.id, reason: e.message });
        }
      }
      settings[executable] = [...managed.values()];
    } catch (e) {
      reports[install.id] = [{ reason: e.message }];
      wanted.push(...previous.filter((r) => r.installId === install.id));
    }
  }
  await fs.mkdir(library.root, { recursive: true });
  // Persist disable instructions before removing any native links.
  await writeJSON(stateFile, settings);
  const retained = [...wanted];
  for (const record of previous) {
    if (wanted.some((w) => w.dest === record.dest)) continue;
    try {
      if (
        (await fs.lstat(record.dest)).isSymbolicLink() &&
        path.resolve(
          path.dirname(record.dest),
          (await fs.readlink(record.dest)).replace(/^\\\\\?\\/, ""),
        ) === record.target
      )
        await fs.unlink(record.dest);
    } catch (e) {
      if (e.code !== "ENOENT") {
        retained.push(record);
        throw e;
      }
    }
  }
  await writeJSON(ledgerFile, retained);
  return reports;
}

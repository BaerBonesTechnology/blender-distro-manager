import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Library } from "../packages/core/library.js";
import { syncNative } from "../packages/core/native-integration.js";
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bdm-native-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const library = new Library(path.join(root, "library"));
  const exe = path.join(root, "blender");
  await fs.writeFile(exe, "");
  const build = await library.importInstall({
    name: "Test Blender",
    executable: exe,
  });
  const folder = path.join(root, "demo");
  await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, "__init__.py"), "# fixture");
  const addon = await library.importAddon(folder);
  const native = {
    scripts: path.join(root, "native", "scripts"),
    config: path.join(root, "native", "config"),
    extensions: path.join(root, "native", "extensions", "user_default"),
    version: "5.2.2",
  };
  return { root, library, build, addon, native, probe: async () => native };
}
test("native links and startup module persist independently; enable choice updates", async (t) => {
  const f = await fixture(t);
  await syncNative(f.library, { probe: f.probe });
  assert.equal(
    await fs.realpath(path.join(f.native.scripts, "addons", "demo")),
    await fs.realpath(f.addon.path),
  );
  assert.match(
    await fs.readFile(
      path.join(f.native.scripts, "startup", "bdm_shared_library.py"),
      "utf8",
    ),
    /bpy.app.binary_path/,
  );
  const state = () =>
    fs
      .readFile(path.join(f.library.root, "native-addons.json"), "utf8")
      .then(JSON.parse);
  assert.equal((await state())[f.build.executable][0].enabled, true);
  await f.library.setEnabled(f.addon.id, f.build.id, false);
  await syncNative(f.library, { probe: f.probe });
  assert.equal((await state())[f.build.executable][0].enabled, false);
});
test("independent add-on is preserved and never disabled by the manager", async (t) => {
  const f = await fixture(t);
  const dest = path.join(f.native.scripts, "addons", "demo");
  await fs.mkdir(dest, { recursive: true });
  await fs.writeFile(path.join(dest, "mine"), "keep");
  const reports = await syncNative(f.library, { probe: f.probe });
  assert.match(reports[f.build.id][0].reason, /independently/);
  assert.equal(await fs.readFile(path.join(dest, "mine"), "utf8"), "keep");
  assert.deepEqual(
    JSON.parse(
      await fs.readFile(
        path.join(f.library.root, "native-addons.json"),
        "utf8",
      ),
    )[f.build.executable],
    [],
  );
});
test("uninstall removes native links and persists disabled state", async (t) => {
  const f = await fixture(t);
  await syncNative(f.library, { probe: f.probe });
  await f.library.removeAddon(f.addon.id);
  await syncNative(f.library, { probe: f.probe });
  await assert.rejects(fs.lstat(path.join(f.native.scripts, "addons", "demo")));
  assert.equal(
    JSON.parse(
      await fs.readFile(
        path.join(f.library.root, "native-addons.json"),
        "utf8",
      ),
    )[f.build.executable][0].enabled,
    false,
  );
});

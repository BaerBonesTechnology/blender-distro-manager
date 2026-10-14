import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Library } from "../packages/core/library.js";
import { createStore } from "../apps/web/store.js";
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bdm-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
test("imports persist and duplicate executable is rejected", async (t) => {
  const root = await fixture(t);
  const executable = path.join(root, "blender");
  await fs.writeFile(executable, "");
  const l = new Library(path.join(root, "managed"));
  const i = await l.importInstall({ name: "Blender", executable });
  assert.equal((await new Library(l.root).read()).installs[0].id, i.id);
  await assert.rejects(
    l.importInstall({ name: "Again", executable }),
    /already/,
  );
});
test("shared add-on links are profile-specific and source is copied", async (t) => {
  const root = await fixture(t);
  const executable = path.join(root, "blender");
  await fs.writeFile(executable, "");
  const addon = path.join(root, "example");
  await fs.mkdir(addon);
  await fs.writeFile(path.join(addon, "__init__.py"), "# trusted");
  const l = new Library(path.join(root, "managed"));
  const i = await l.importInstall({ name: "Blender", executable });
  const a = await l.importAddon(addon);
  await l.share(i.id, a.id);
  const link = path.join(
    l.root,
    "profiles",
    i.id,
    "scripts",
    "addons",
    "example",
  );
  assert.equal(await fs.realpath(link), await fs.realpath(a.path));
  assert.notEqual(a.path, addon);
  await assert.rejects(l.share(i.id, a.id), /already/);
  await assert.rejects(l.share("../escape", a.id), /Unknown/);
});
test("rejects binary add-ons and symlinks", async (t) => {
  const root = await fixture(t);
  const addon = path.join(root, "example");
  await fs.mkdir(addon);
  await fs.writeFile(path.join(addon, "__init__.py"), "");
  await fs.writeFile(path.join(addon, "dependency.whl"), "");
  const l = new Library(path.join(root, "managed"));
  await assert.rejects(l.importAddon(addon), /pure-Python/);
  await fs.rm(path.join(addon, "dependency.whl"));
  await fs.symlink(
    root,
    path.join(addon, "escape"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(l.importAddon(addon), /symbolic/);
});
test("submissions stay private until reviewed and persist across restart", async (t) => {
  const root = await fixture(t);
  const file = path.join(root, "db.sqlite");
  let db = createStore(file);
  const result = db.submit({
    name: "Example",
    description: "A distro",
    url: "https://example.com",
    contact: "private@example.com",
  });
  assert.deepEqual(db.public(), []);
  db.close();
  db = createStore(file);
  assert.equal(db.pending().length, 1);
  db.review(result.id, "approved");
  assert.equal(db.public()[0].name, "Example");
  assert.equal("contact" in db.public()[0], false);
  assert.throws(() => db.review(result.id, "approved"), /not found/);
  db.close();
});
test("rejects unsafe submission URLs and oversized fields", () => {
  const db = createStore(":memory:");
  const input = {
    name: "Test",
    description: "Test",
    url: "javascript:alert(1)",
    contact: "test",
  };
  assert.throws(() => db.submit(input), /HTTPS/);
  assert.throws(() => db.submit({ ...input, name: "x".repeat(81) }), /name/);
  db.close();
});

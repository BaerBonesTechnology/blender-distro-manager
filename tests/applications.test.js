import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  addApplication,
  removeApplication,
} from "../packages/core/applications.js";
import { Library } from "../packages/core/library.js";

test("Applications shortcuts preserve other apps, support versions and clean up only owned links", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bdm-shortcuts-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "Applications");
  const options = { platform: "darwin", directories: [directory] };
  const executable = path.join(
    root,
    "installed/Blender.app/Contents/MacOS/Blender",
  );
  await fs.mkdir(path.dirname(executable), { recursive: true });
  await fs.writeFile(executable, "fixture");
  await fs.mkdir(path.join(directory, "Blender.app"), { recursive: true });
  const item = { id: "one", managed: true, version: "5.2.2", executable };
  const library = new Library(path.join(root, "library"));
  await library.update((s) => s.installs.push(item));
  assert.deepEqual(await library.syncApplications(options), {});
  const installed = (await library.read()).installs[0];
  assert.equal(
    path.basename(installed.applicationShortcut),
    "Blender 5.2.2.app",
  );
  assert.equal(
    await addApplication(installed, options),
    installed.applicationShortcut,
  );
  // A broken link after the payload is trashed still belongs to the installation.
  await fs.rm(path.join(root, "installed"), { recursive: true });
  await library.forgetInstall(item.id);
  await assert.rejects(fs.lstat(installed.applicationShortcut), {
    code: "ENOENT",
  });
  assert.ok((await fs.stat(path.join(directory, "Blender.app"))).isDirectory());
  // A user replacement is not ours to remove.
  await fs.mkdir(installed.applicationShortcut);
  await removeApplication(installed);
  assert.ok((await fs.stat(installed.applicationShortcut)).isDirectory());
  assert.equal(
    await addApplication(item, { ...options, platform: "win32" }),
    null,
  );
  assert.equal(
    await addApplication({ ...item, managed: false }, options),
    null,
  );
});

test("existing matching manual shortcut is adopted without duplication", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bdm-shortcuts-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const executable = path.join(
    root,
    "Kitchen 3D.app/Contents/MacOS/Kitchen 3D",
  );
  await fs.mkdir(path.dirname(executable), { recursive: true });
  await fs.writeFile(executable, "fixture");
  const directory = path.join(root, "Applications");
  await fs.mkdir(directory);
  const link = path.join(directory, "Kitchen 3D.app");
  await fs.symlink(path.join(root, "Kitchen 3D.app"), link);
  assert.equal(
    await addApplication(
      { id: "test", managed: true, executable },
      {
        platform: "darwin",
        directories: [directory],
      },
    ),
    link,
  );
  assert.deepEqual(await fs.readdir(directory), ["Kitchen 3D.app"]);
});

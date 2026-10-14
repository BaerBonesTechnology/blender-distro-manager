import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

function bundle(install) {
  const suffix = `${path.sep}Contents${path.sep}MacOS${path.sep}`;
  const index = install.executable.indexOf(suffix);
  const app = index < 0 ? null : install.executable.slice(0, index);
  return app?.endsWith(".app") ? app : null;
}
async function pointsTo(link, target) {
  try {
    return path.resolve(path.dirname(link), await fs.readlink(link)) === target;
  } catch (error) {
    if (["ENOENT", "EINVAL"].includes(error.code)) return false;
    throw error;
  }
}
export async function addApplication(
  install,
  {
    platform = process.platform,
    directories = ["/Applications", path.join(os.homedir(), "Applications")],
  } = {},
) {
  if (platform !== "darwin" || !install.managed) return null;
  const app = bundle(install);
  if (!app) return null;
  await fs.access(install.executable);
  if (
    install.applicationShortcut &&
    (await pointsTo(install.applicationShortcut, app))
  )
    return install.applicationShortcut;
  for (const directory of directories) {
    try {
      await fs.mkdir(directory, { recursive: true });
      const base = path.basename(app, ".app");
      const version = String(install.version || install.id).replace(
        /[^a-zA-Z0-9._-]/g,
        "_",
      );
      const names = [
        `${base}.app`,
        `${base} ${version}.app`,
        `${base} ${version} ${install.id}.app`,
      ];
      for (const name of names) {
        const link = path.join(directory, name);
        if (await pointsTo(link, app)) return link;
        try {
          await fs.symlink(app, link);
          return link;
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
        }
      }
    } catch (error) {
      if (!["EACCES", "EPERM", "EROFS"].includes(error.code)) throw error;
    }
  }
  throw Error(
    "Could not create an Applications shortcut. Check Applications folder permissions.",
  );
}
export async function removeApplication(install) {
  const app = bundle(install);
  const link = install.applicationShortcut;
  // Never remove an app or a shortcut that has been replaced by the user.
  if (app && link && (await pointsTo(link, app))) await fs.unlink(link);
}

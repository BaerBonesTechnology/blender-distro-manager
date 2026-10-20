import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
export async function detectInstallations(roots) {
  const home = os.homedir();
  roots ||=
    process.platform === "darwin"
      ? [
          "/Applications",
          path.join(home, "Applications"),
          path.join(home, "Documents", "Projects"),
        ]
      : process.platform === "win32"
        ? [
            process.env.ProgramFiles,
            process.env["ProgramFiles(x86)"],
            path.join(process.env.LOCALAPPDATA || home, "Programs"),
          ].filter(Boolean)
        : [
            "/opt",
            path.join(home, "Applications"),
            "/usr/local/bin",
            "/usr/bin",
          ];
  const candidates = [];
  async function walk(dir, depth) {
    if (depth > 4) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (
        e.isDirectory() &&
        /\.(app)$/i.test(e.name) &&
        /blender|kitchen|blaya|mixar/i.test(e.name)
      ) {
        let binaries = [];
        try {
          binaries = await fs.readdir(path.join(full, "Contents", "MacOS"));
        } catch {}
        const binary = binaries.find((n) =>
          /^(blender|kitchen ?3d|blaya|mixar)$/i.test(n),
        );
        if (binary)
          candidates.push({
            executable: path.join(full, "Contents", "MacOS", binary),
            uninstallPath: full,
          });
      } else if (
        e.isDirectory() &&
        /blender|kitchen|blaya|mixar|^bin$|^Blender Foundation$/i.test(e.name)
      )
        await walk(full, depth + 1);
      else if (
        e.isFile() &&
        /^(blender|kitchen3d|mixar)(\.exe)?$/i.test(e.name)
      )
        candidates.push({
          executable: full,
          uninstallPath: /blender|kitchen|mixar/i.test(path.basename(dir))
            ? dir
            : null,
        });
    }
  }
  for (const root of roots) await walk(root, 0);
  const result = [];
  for (const candidate of candidates) {
    try {
      const executable = await fs.realpath(candidate.executable);
      const { stdout } = await promisify(execFile)(executable, ["--version"], {
        timeout: 15000,
      });
      const version = stdout.match(
        /(?:Blender|Kitchen\s*3D|Mixar)\s+(\d+\.\d+\.\d+)/i,
      )?.[1];
      if (!version) continue;
      const distro = /mixar/i.test(candidate.executable)
        ? "mixar"
        : /kitchen|blaya/i.test(candidate.executable)
          ? "kitchen3d"
          : "blender";
      result.push({
        ...candidate,
        executable,
        version,
        distro,
        name: `${distro === "mixar" ? "Mixar" : distro === "blender" ? "Blender" : "Kitchen 3D"} ${version}`,
        external: true,
      });
    } catch {}
  }
  return result;
}

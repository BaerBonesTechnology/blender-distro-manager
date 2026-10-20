import { packager } from "@electron/packager";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const platform = process.platform;
const arch = process.arch;
const labels = { darwin: "macOS", win32: "Windows", linux: "Linux" };
if (!labels[platform])
  throw Error(`Unsupported packaging platform: ${platform}`);
const outputs = await packager({
  dir: ".",
  name: "Blender Distro Manager",
  platform,
  arch,
  out: "dist",
  overwrite: true,
  asar: true,
  prune: true,
  icon: path.resolve(
    "apps/desktop/assets",
    platform === "darwin"
      ? "icon.icns"
      : platform === "win32"
        ? "icon.ico"
        : "app-icon.png",
  ),
  appBundleId: "org.blenderdistromanager.desktop",
  appCategoryType: "public.app-category.graphics-design",
  ignore: [
    /^\/\.data(?:\/|$)/,
    /^\/dist(?:\/|$)/,
    /^\/tests(?:\/|$)/,
    /^\/build(?:\/|$)/,
    /^\/\.github(?:\/|$)/,
  ],
});
for (const output of outputs) {
  const name = `Blender-Distro-Manager-${labels[platform]}-${arch}`;
  let archive;
  if (platform === "darwin") {
    const app = path.join(output, "Blender Distro Manager.app");
    execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], {
      stdio: "inherit",
    });
    execFileSync("codesign", ["--verify", "--deep", "--strict", app], {
      stdio: "inherit",
    });
    archive = path.resolve("dist", `${name}.zip`);
    await fs.rm(archive, { force: true });
    execFileSync(
      "ditto",
      ["-c", "-k", "--sequesterRsrc", "--keepParent", app, archive],
      { stdio: "inherit" },
    );
  } else if (platform === "win32") {
    archive = path.resolve("dist", `${name}.zip`);
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Compress-Archive -LiteralPath $env:BDM_PACKAGE_SOURCE -DestinationPath $env:BDM_PACKAGE_ARCHIVE -Force",
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          BDM_PACKAGE_SOURCE: path.resolve(output),
          BDM_PACKAGE_ARCHIVE: archive,
        },
      },
    );
  } else {
    archive = path.resolve("dist", `${name}.tar.gz`);
    execFileSync(
      "tar",
      ["-czf", archive, "-C", path.dirname(output), path.basename(output)],
      { stdio: "inherit" },
    );
  }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  await fs.writeFile(
    `${archive}.sha256`,
    `${hash.digest("hex")}  ${path.basename(archive)}\n`,
  );
  console.log(`Package: ${archive}`);
}

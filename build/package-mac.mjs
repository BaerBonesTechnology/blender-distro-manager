import { packager } from "@electron/packager";
import { execFileSync } from "node:child_process";
import path from "node:path";
const outputs = await packager({
  dir: ".",
  name: "Blender Distro Manager",
  platform: "darwin",
  arch: "arm64",
  out: "dist",
  overwrite: true,
  asar: true,
  prune: true,
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
  const app = path.join(output, "Blender Distro Manager.app");
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], {
    stdio: "inherit",
  });
  const zip = path.resolve("dist/Blender-Distro-Manager-macOS-arm64.zip");
  execFileSync(
    "ditto",
    ["-c", "-k", "--sequesterRsrc", "--keepParent", app, zip],
    { stdio: "inherit" },
  );
  console.log(`App: ${app}\nZIP: ${zip}`);
}

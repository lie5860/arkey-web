import { cpSync, existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const runtimeApp = join(homedir(), ".arkey", "app");

function deployRuntime(cliPath: string): string {
  let root = dirname(realpathSync(cliPath));
  while (dirname(root) !== root && !existsSync(join(root, "package.json"))) root = dirname(root);
  if (!existsSync(join(root, "package.json"))) throw new Error("Cannot locate Arkey package root");
  rmSync(runtimeApp, { recursive: true, force: true });
  mkdirSync(runtimeApp, { recursive: true, mode: 0o700 });
  for (const name of ["dist", "profiles", "node_modules", "package.json"]) cpSync(join(root, name), join(runtimeApp, name), { recursive: true });
  const firmwareBinary = join(root, "build", "arkey-q6-pro-ansi-v0.1.0.bin");
  if (existsSync(firmwareBinary)) {
    mkdirSync(join(runtimeApp, "build"), { recursive: true, mode: 0o700 });
    cpSync(firmwareBinary, join(runtimeApp, "build", "arkey-q6-pro-ansi-v0.1.0.bin"));
  }
  return join(runtimeApp, "dist", "src", "cli.js");
}

export const launchAgentPath = join(homedir(), "Library", "LaunchAgents", "io.arkey.daemon.plist");

export function installLaunchAgent(cliPath: string): void {
  mkdirSync(dirname(launchAgentPath), { recursive: true });
  const logDir = join(homedir(), ".arkey"); mkdirSync(logDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(logDir, "daemon.log"), "", { mode: 0o644 });
  writeFileSync(join(logDir, "daemon-error.log"), "", { mode: 0o644 });
  const entrypoint = deployRuntime(cliPath);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>io.arkey.daemon</string>
<key>ProgramArguments</key><array><string>${process.execPath}</string><string>${entrypoint}</string><string>daemon</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
<key>StandardOutPath</key><string>${join(logDir, "daemon.log")}</string>
<key>StandardErrorPath</key><string>${join(logDir, "daemon-error.log")}</string>
</dict></plist>\n`;
  writeFileSync(launchAgentPath, xml, { mode: 0o644 });
  const domain = `gui/${process.getuid?.() ?? 501}`;
  spawnSync("launchctl", ["bootout", domain, launchAgentPath], { stdio: "ignore" });
  const result = spawnSync("launchctl", ["bootstrap", domain, launchAgentPath], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "launchctl bootstrap failed");
}

export function stopLaunchAgent(): void {
  const domain = `gui/${process.getuid?.() ?? 501}`;
  spawnSync("launchctl", ["bootout", domain, launchAgentPath], { stdio: "ignore" });
}

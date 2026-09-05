import { spawn } from "node:child_process";

const isWin = process.platform === "win32";
const npm = isWin ? "npm.cmd" : "npm";
const children = ["dev:server", "dev:client"].map(script => spawn(npm, ["run", script], { stdio: "inherit", shell: isWin }));

const stop = () => children.forEach(child => child.kill("SIGINT"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
children.forEach(child => child.on("exit", code => { if (code && !process.exitCode) process.exitCode = code; }));
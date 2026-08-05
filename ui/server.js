"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { StringDecoder } = require("string_decoder");
const { validateConfig, validateHardware } = require("./config-validator");
const { version: PACKAGE_VERSION } = require("./package.json");

const portText = process.env.PORT || "3000";
const parsedPort = /^\d+$/.test(portText) ? Number(portText) : Number.NaN;
if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

const PORT = parsedPort;
const HOST = "127.0.0.1";
const TEST_MODE = process.env.WIN11OPT_TEST_MODE === "1";
const ELECTRON_PACKAGED_REQUESTED = process.env.WIN11OPT_ELECTRON_PACKAGED === "1";
const ELECTRON_RESOURCES_DIR = typeof process.resourcesPath === "string" && path.isAbsolute(process.resourcesPath)
  ? path.resolve(process.resourcesPath)
  : null;
const IS_PACKAGED = ELECTRON_PACKAGED_REQUESTED && ELECTRON_RESOURCES_DIR !== null;
const SYSTEM_ROOT = resolveTrustedSystemRoot();
const SYSTEM32_DIR = path.join(SYSTEM_ROOT, "System32");
const WINDOWS_POWERSHELL_DIR = path.join(SYSTEM32_DIR, "WindowsPowerShell", "v1.0");
const POWERSHELL_EXE = path.join(WINDOWS_POWERSHELL_DIR, "powershell.exe");
const ICACLS_EXE = path.join(SYSTEM32_DIR, "icacls.exe");
const TASKKILL_EXE = path.join(SYSTEM32_DIR, "taskkill.exe");
const SHUTDOWN_EXE = path.join(SYSTEM32_DIR, "shutdown.exe");
const RUNDLL32_EXE = path.join(SYSTEM32_DIR, "rundll32.exe");
const CMD_EXE = path.join(SYSTEM32_DIR, "cmd.exe");
const PROJECT_ROOT = path.resolve(__dirname, "..");
const UI_DIR = path.join(__dirname, "out");
const SESSION_HEADER = "x-win11opt-session";
const SESSION_TOKEN = crypto.randomBytes(32).toString("hex");
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_LOG_LINES = 500;
const MAX_PROCESS_OUTPUT_BYTES = 5 * 1024 * 1024;
const DEFAULT_POWERSHELL_TIMEOUT_MS = 10 * 60 * 1000;
const OPTIMIZE_TIMEOUT_MS = 30 * 60 * 1000;
const PROCESS_TREE_KILL_TIMEOUT_MS = 5_000;
const SNAPSHOT_PRESETS = new Set(["current", "conservative", "balanced", "extreme", "custom"]);

let CONFIG_DIR = path.join(PROJECT_ROOT, "config", "output");
let SCRIPTS_DIR = path.join(PROJECT_ROOT, "scripts");
let runtimeInitialization = null;
let runtimeState = {
  state: "initializing",
  administrator: false,
  secureRuntime: false,
  supportedWindows11: false,
  windows: null,
  error: null,
};

let activeOperation = null;
let execState = { operationId: null, operation: null, running: false, phase: "", progress: 0, message: "", log: [], result: null };
let cleanupFailure = null;
const inFlightTasks = new Map();
const activeChildProcesses = new Set();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function buildChildEnvironment(dataDirectory) {
  const systemDrive = path.parse(SYSTEM_ROOT).root.replace(/[\\/]$/, "");
  const environment = {
    SystemRoot: SYSTEM_ROOT,
    WINDIR: SYSTEM_ROOT,
    SystemDrive: systemDrive,
    ProgramFiles: path.join(systemDrive, "Program Files"),
    "ProgramFiles(x86)": path.join(systemDrive, "Program Files (x86)"),
    ComSpec: CMD_EXE,
    PATH: [SYSTEM32_DIR, SYSTEM_ROOT, WINDOWS_POWERSHELL_DIR].join(path.delimiter),
    PATHEXT: ".COM;.EXE;.BAT;.CMD",
    PSModulePath: path.join(WINDOWS_POWERSHELL_DIR, "Modules"),
  };
  if (dataDirectory) environment.WIN11OPTIMIZER_DATA_DIR = dataDirectory;
  return environment;
}

function resolveTrustedSystemRoot() {
  if (process.platform !== "win32") return path.parse(process.execPath).root;
  const trustedRoot = "\\\\?\\GLOBALROOT\\SystemRoot";
  const resolved = IS_PACKAGED
    ? fs.realpathSync.native(process.env.SystemRoot || "")
    : fs.realpathSync.native(trustedRoot);
  if (!path.win32.isAbsolute(resolved)) throw new Error("Unable to resolve the Windows system directory");
  if (IS_PACKAGED) {
    const trustedStats = fs.statSync(path.win32.join(trustedRoot, "System32", "kernel32.dll"), { bigint: true });
    const resolvedStats = fs.statSync(path.win32.join(resolved, "System32", "kernel32.dll"), { bigint: true });
    if (!trustedStats.isFile() || !resolvedStats.isFile() || trustedStats.dev !== resolvedStats.dev || trustedStats.ino !== resolvedStats.ino) {
      throw new Error("Unable to verify the Windows system directory");
    }
  }
  return path.win32.resolve(resolved);
}

function isWindows11Workstation(info) {
  if (!info || typeof info !== "object") return false;
  const buildNumber = Number.parseInt(info.BuildNumber, 10);
  const productType = Number.parseInt(info.ProductType, 10);
  return Number.isInteger(buildNumber) && buildNumber >= 22000 && productType === 1;
}

function normalizeResolvedPath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

async function assertCanonicalFileSystemEntry(entryPath) {
  const stats = await fs.promises.lstat(entryPath);
  if (stats.isSymbolicLink()) throw new Error(`Reparse points are not allowed: ${entryPath}`);
  const realPath = await fs.promises.realpath(entryPath);
  if (normalizeResolvedPath(entryPath) !== normalizeResolvedPath(realPath)) {
    throw new Error(`Reparse points are not allowed: ${entryPath}`);
  }
  return stats;
}

async function assertNoReparsePoints(directory) {
  const pending = [path.resolve(directory)];
  while (pending.length) {
    const current = pending.pop();
    const stats = await assertCanonicalFileSystemEntry(current);
    if (stats.isDirectory()) {
      for (const name of await fs.promises.readdir(current)) pending.push(path.join(current, name));
    } else if (!stats.isFile()) {
      throw new Error(`Special filesystem entries are not allowed: ${current}`);
    }
  }
}

async function ensureSecureRuntimeDirectory(directory, administrator) {
  if (!administrator) throw new Error("Secure runtime initialization requires administrator privileges");
  await fs.promises.mkdir(directory, { recursive: true });

  const stats = await assertCanonicalFileSystemEntry(directory);
  if (!stats.isDirectory()) throw new Error("Secure runtime path must be a directory");
  await assertNoReparsePoints(directory);

  const applyAcl = async (args) => {
    const result = await runNative(ICACLS_EXE, args, 30_000);
    if (result.code !== 0) {
      throw new Error(`Unable to secure runtime directory: ${String(result.stderr || result.stdout || "icacls failed").trim()}`);
    }
  };

  for (const args of [
    [directory, "/setowner", "*S-1-5-32-544", "/Q", "/L"],
    [directory, "/reset", "/Q", "/L"],
    [directory, "/inheritance:r", "/grant:r", "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F", "/Q", "/L"],
  ]) {
    await applyAcl(args);
  }

  await assertNoReparsePoints(directory);
  if ((await fs.promises.readdir(directory)).length > 0) {
    const contents = path.join(directory, "*");
    for (const args of [
      [contents, "/setowner", "*S-1-5-32-544", "/T", "/Q", "/L"],
      [contents, "/grant:r", "*S-1-5-18:F", "*S-1-5-32-544:F", "/T", "/Q", "/L"],
      [contents, "/reset", "/T", "/Q", "/L"],
    ]) {
      await applyAcl(args);
    }
  }
  await assertNoReparsePoints(directory);
}

async function inspectScriptBundle(directory, includeContents = false, trustedEmbeddedAssets = false) {
  const root = path.resolve(directory);
  const rootStats = trustedEmbeddedAssets ? await fs.promises.lstat(root) : await assertCanonicalFileSystemEntry(root);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) throw new Error(`Script bundle is not a regular directory: ${root}`);

  const entries = [];
  const visit = async (currentDirectory, relativeDirectory) => {
    const names = (await fs.promises.readdir(currentDirectory)).sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
    for (const name of names) {
      const fullPath = path.join(currentDirectory, name);
      const relativePath = relativeDirectory ? path.join(relativeDirectory, name) : name;
      if (!isPathInside(root, fullPath)) throw new Error(`Script bundle entry escapes its root: ${relativePath}`);
      const stats = trustedEmbeddedAssets ? await fs.promises.lstat(fullPath) : await assertCanonicalFileSystemEntry(fullPath);
      if (stats.isSymbolicLink()) throw new Error(`Reparse points are not allowed in script bundles: ${relativePath}`);
      if (stats.isDirectory()) {
        await visit(fullPath, relativePath);
        continue;
      }
      if (!stats.isFile()) throw new Error(`Special entries are not allowed in script bundles: ${relativePath}`);
      if (!/\.psm?1$/i.test(name)) throw new Error(`Unexpected script bundle file type: ${relativePath}`);
      const content = await fs.promises.readFile(fullPath);
      entries.push({
        relativePath: relativePath.split(path.sep).join("/"),
        sha256: crypto.createHash("sha256").update(content).digest("hex"),
        size: content.length,
        ...(includeContents ? { content } : {}),
      });
    }
  };
  await visit(root, "");
  if (!entries.length) throw new Error("Embedded PowerShell bundle is empty");

  const digest = crypto.createHash("sha256");
  for (const entry of entries) {
    digest.update(entry.relativePath, "utf8");
    digest.update("\0");
    digest.update(entry.sha256, "ascii");
    digest.update("\0");
    digest.update(String(entry.size), "ascii");
    digest.update("\n");
  }
  return { digest: digest.digest("hex"), entries };
}

function assertMatchingScriptBundle(actual, expected, directory) {
  const sameEntries = actual.entries.length === expected.entries.length
    && actual.entries.every((entry, index) => {
      const expectedEntry = expected.entries[index];
      return entry.relativePath === expectedEntry.relativePath
        && entry.sha256 === expectedEntry.sha256
        && entry.size === expectedEntry.size;
    });
  if (actual.digest !== expected.digest || !sameEntries) {
    throw new Error(`Extracted PowerShell bundle failed integrity verification: ${directory}`);
  }
}

async function pathExists(targetPath) {
  try {
    await fs.promises.access(targetPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function extractPackagedScripts(embeddedDirectory, runtimeDirectory, administrator) {
  const expected = await inspectScriptBundle(embeddedDirectory, true, true);
  await ensureSecureRuntimeDirectory(runtimeDirectory, administrator);

  const targetDirectory = path.join(runtimeDirectory, `scripts-${expected.digest}`);
  if (await pathExists(targetDirectory)) {
    assertMatchingScriptBundle(await inspectScriptBundle(targetDirectory), expected, targetDirectory);
    return targetDirectory;
  }

  const temporaryDirectory = path.join(runtimeDirectory, `scripts-${expected.digest}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  try {
    await fs.promises.mkdir(temporaryDirectory, { recursive: false });
    for (const entry of expected.entries) {
      const outputPath = path.join(temporaryDirectory, ...entry.relativePath.split("/"));
      if (!isPathInside(temporaryDirectory, outputPath)) throw new Error(`Invalid embedded script path: ${entry.relativePath}`);
      await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.promises.writeFile(outputPath, entry.content, { flag: "wx" });
    }
    assertMatchingScriptBundle(await inspectScriptBundle(temporaryDirectory), expected, temporaryDirectory);
    try {
      await fs.promises.rename(temporaryDirectory, targetDirectory);
    } catch (error) {
      if (!await pathExists(targetDirectory)) throw error;
    }
  } finally {
    if (await pathExists(temporaryDirectory)) await fs.promises.rm(temporaryDirectory, { recursive: true, force: true });
  }

  await ensureSecureRuntimeDirectory(targetDirectory, administrator);
  assertMatchingScriptBundle(await inspectScriptBundle(targetDirectory), expected, targetDirectory);
  return targetDirectory;
}

function assertMutationRuntime() {
  if (cleanupFailure) throw new HttpError(503, `A previous operation could not be stopped safely: ${cleanupFailure.message}`);
  if (runtimeState.state !== "ready") throw new HttpError(503, "Runtime initialization is not ready");
  assertMutationCapabilities(runtimeState.administrator, runtimeState.secureRuntime, runtimeState.supportedWindows11);
}

function assertMutationCapabilities(administrator, secureRuntime, supportedWindows11) {
  if (!supportedWindows11) throw new HttpError(503, "Windows 11 client edition is required for system changes");
  if (!administrator) throw new HttpError(503, "Administrator privileges are required for system changes");
  if (!secureRuntime) throw new HttpError(503, "Secure runtime storage is required for system changes");
}

function appendLog(...lines) {
  execState.log.push(...lines);
  if (execState.log.length > MAX_LOG_LINES) {
    execState.log.splice(0, execState.log.length - MAX_LOG_LINES);
  }
}

function isPathInside(basePath, candidatePath) {
  const relative = path.relative(path.resolve(basePath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function isLoopbackAddress(address) {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function authorizeLoopbackHost(req) {
  if (!isLoopbackAddress(req.socket.remoteAddress || "")) throw new HttpError(403, "Loopback access only");

  const localPort = req.socket.localPort;
  if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535) throw new HttpError(403, "Invalid local port");
  const allowedHosts = new Set([`${HOST}:${localPort}`, `localhost:${localPort}`]);
  if (!allowedHosts.has(String(req.headers.host || "").toLowerCase())) throw new HttpError(403, "Invalid host");
  return localPort;
}

function authorizeAPI(req) {
  const localPort = authorizeLoopbackHost(req);

  const origin = req.headers.origin;
  if (origin && origin !== `http://${HOST}:${localPort}` && origin !== `http://localhost:${localPort}`) {
    throw new HttpError(403, "Invalid origin");
  }

  const session = req.headers[SESSION_HEADER];
  if (!safeEqual(session, SESSION_TOKEN)) throw new HttpError(401, "Unauthorized session");
}

function securityHeaders(contentType) {
  return {
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
  };
}

function json(res, status, data) {
  res.writeHead(status, securityHeaders("application/json; charset=utf-8"));
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const declaredLength = Number.parseInt(req.headers["content-length"] || "0", 10);
    if (declaredLength > MAX_BODY_BYTES) {
      req.resume();
      reject(new HttpError(413, "Request body too large"));
      return;
    }

    const chunks = [];
    let totalBytes = 0;
    let rejected = false;
    req.on("data", (chunk) => {
      if (rejected) return;
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        rejected = true;
        reject(new HttpError(413, "Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (rejected) return;
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        const body = raw ? JSON.parse(raw) : {};
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          reject(new HttpError(400, "JSON body must be an object"));
          return;
        }
        resolve(body);
      } catch {
        reject(new HttpError(400, "Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tempPath, filePath);
}

function quotePowerShell(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function encodePowerShell(command) {
  return Buffer.from(command, "utf16le").toString("base64");
}

function buildScriptCommand(script, args = []) {
  const renderedArgs = args.map((arg) => (/^-[A-Za-z][A-Za-z0-9]*$/.test(arg) ? arg : quotePowerShell(arg)));
  const invocation = `& ${quotePowerShell(script)} ${renderedArgs.join(" ")}`.trim();
  return [
    "$ErrorActionPreference = 'Stop';",
    "$ProgressPreference = 'SilentlyContinue';",
    "$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false);",
    "$exitCode = 0;",
    "try {",
    `${invocation} *>&1 | ForEach-Object {`,
    "if ($_ -is [System.Management.Automation.ErrorRecord]) { [Console]::Out.WriteLine('[ERR] ' + [string]$_) }",
    "elseif ($_ -is [System.Management.Automation.WarningRecord]) { [Console]::Out.WriteLine('[WARN] ' + [string]$_) }",
    "elseif ($_ -isnot [System.Management.Automation.ProgressRecord]) { [Console]::Out.WriteLine([string]$_) }",
    "};",
    "if ($null -ne $LASTEXITCODE) { $exitCode = $LASTEXITCODE };",
    "} catch {",
    "[Console]::Out.WriteLine('[ERR] ' + $_.Exception.Message);",
    "$exitCode = 1;",
    "};",
    "exit $exitCode",
  ].join(" ");
}

function trackChildProcess(child) {
  activeChildProcesses.add(child);
  const forget = () => activeChildProcesses.delete(child);
  child.once("error", forget);
  child.once("close", forget);
  return child;
}

function spawnPowerShell(command) {
  return trackChildProcess(spawn(POWERSHELL_EXE, ["-ExecutionPolicy", "Bypass", "-NoProfile", "-EncodedCommand", encodePowerShell(command)], {
    env: buildChildEnvironment(CONFIG_DIR),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  }));
}

function runNative(executable, args, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const child = trackChildProcess(spawn(executable, args, {
      env: buildChildEnvironment(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }));
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(result);
    };
    const collect = (target, chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_PROCESS_OUTPUT_BYTES) {
        void terminateProcessTree(child).then(
          () => finish(new Error(`Process output exceeded ${MAX_PROCESS_OUTPUT_BYTES} bytes`)),
          (error) => finish(error),
        );
        return;
      }
      target.push(chunk);
    };
    const timeout = setTimeout(() => {
      void terminateProcessTree(child).then(
        () => finish(new Error(`Process timed out after ${timeoutMs} ms`)),
        (error) => finish(error),
      );
    }, timeoutMs);
    child.stdout.on("data", (chunk) => collect(stdout, chunk));
    child.stderr.on("data", (chunk) => collect(stderr, chunk));
    child.once("error", (error) => finish(error));
    child.once("close", (code) => finish(null, {
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
      code: Number.isInteger(code) ? code : 1,
    }));
  });
}

function terminateProcessTree(child) {
  if (!child.pid || child.exitCode !== null) return Promise.resolve();

  if (process.platform !== "win32") {
    try { child.kill("SIGKILL"); } catch {}
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let finished = false;
    let fallbackTimeout = null;
    let killer = null;
    const finish = (error = null) => {
      if (finished) return;
      finished = true;
      if (fallbackTimeout) clearTimeout(fallbackTimeout);
      if (child.exitCode === null) {
        try { child.kill(); } catch {}
      }
      if (error) reject(error);
      else resolve();
    };

    try {
      killer = spawn(TASKKILL_EXE, ["/PID", String(child.pid), "/T", "/F"], {
        env: buildChildEnvironment(),
        windowsHide: true,
        stdio: "ignore",
      });
      killer.once("error", (error) => finish(new Error(`Unable to start process-tree cleanup: ${error.message}`)));
      killer.once("close", (code) => {
        if (code === 0) {
          finish();
          return;
        }
        finish(new Error(`Unable to terminate the PowerShell process tree: taskkill exited with code ${code}`));
      });
      fallbackTimeout = setTimeout(() => {
        if (killer?.exitCode === null) {
          try { killer.kill(); } catch {}
        }
        finish(new Error(`Process-tree cleanup timed out after ${PROCESS_TREE_KILL_TIMEOUT_MS} ms`));
      }, PROCESS_TREE_KILL_TIMEOUT_MS);
    } catch (error) {
      finish(new Error(`Unable to start process-tree cleanup: ${error.message}`));
    }
  });
}

async function terminateAllPowerShellTrees() {
  await Promise.all(Array.from(activeChildProcesses, (child) => terminateProcessTree(child)));
}

function terminateAllPowerShellTreesSync() {
  for (const child of activeChildProcesses) {
    if (!child.pid || child.exitCode !== null) continue;
    if (process.platform === "win32") {
      spawnSync(TASKKILL_EXE, ["/PID", String(child.pid), "/T", "/F"], {
        env: buildChildEnvironment(),
        windowsHide: true,
        stdio: "ignore",
        timeout: PROCESS_TREE_KILL_TIMEOUT_MS,
      });
    } else {
      try { child.kill("SIGKILL"); } catch {}
    }
  }
}

function runPowerShell(command, timeoutMs = DEFAULT_POWERSHELL_TIMEOUT_MS, handlers = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnPowerShell(command);
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;
    let terminationError = null;
    let terminationPromise = null;
    let timeout = null;

    const settle = (error, result) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (error) reject(error);
      else resolve(result);
    };

    const requestTermination = (error) => {
      if (terminationError) return;
      terminationError = error;
      if (timeout) clearTimeout(timeout);
      terminationPromise = terminateProcessTree(child);
      void terminationPromise.then(
        () => settle(terminationError),
        (cleanupError) => {
          cleanupFailure = cleanupError;
          settle(new Error(`${terminationError.message}; cleanup failed: ${cleanupError.message}`));
        },
      );
    };

    timeout = setTimeout(() => {
      if (!settled) requestTermination(new Error(`PowerShell operation timed out after ${timeoutMs} ms`));
    }, timeoutMs);

    const collectText = (target, text, handler) => {
      if (terminationError) return target;
      try {
        handler?.(text);
      } catch (error) {
        requestTermination(error);
      }
      return target + text;
    };

    const collect = (target, chunk, handler, decoder) => {
      if (terminationError) return target;
      outputBytes += chunk.length;
      if (outputBytes > MAX_PROCESS_OUTPUT_BYTES) {
        requestTermination(new Error(`PowerShell output exceeded ${MAX_PROCESS_OUTPUT_BYTES} bytes`));
        return `${target}\n[output limit exceeded]`;
      }
      return collectText(target, decoder.write(chunk), handler);
    };

    child.stdout.on("data", (chunk) => { stdout = collect(stdout, chunk, handlers.onStdout, stdoutDecoder); });
    child.stderr.on("data", (chunk) => { stderr = collect(stderr, chunk, handlers.onStderr, stderrDecoder); });
    child.once("error", (error) => {
      if (settled) return;
      if (child.pid && child.exitCode === null) requestTermination(error);
      else settle(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      stdout = collectText(stdout, stdoutDecoder.end(), handlers.onStdout);
      stderr = collectText(stderr, stderrDecoder.end(), handlers.onStderr);
      if (!terminationError) settle(null, { stdout, stderr, code: Number.isInteger(code) ? code : 1 });
    });
  });
}

function normalizeWindowsInfo(info) {
  if (!info || typeof info !== "object") throw new Error("Windows version detection returned no operating system data");
  const caption = String(info.Caption || "").trim();
  const version = String(info.Version || "").trim();
  const buildNumber = String(info.BuildNumber || "").trim();
  if (!caption || !version || !/^\d+$/.test(buildNumber)) {
    throw new Error("Windows version detection returned incomplete operating system data");
  }
  return {
    caption,
    version,
    buildNumber,
    displayName: `${caption} ${version} (Build ${buildNumber})`,
  };
}

async function detectRuntimeInfo() {
  if (process.platform !== "win32") throw new Error("Windows runtime detection is only available on Windows");
  const command = [
    "$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false);",
    "$identity = [Security.Principal.WindowsIdentity]::GetCurrent()",
    "$principal = [Security.Principal.WindowsPrincipal]::new($identity)",
    "$os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop",
    "$result = [ordered]@{",
    "Administrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
    "CommonApplicationData = [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonApplicationData)",
    "OperatingSystem = [ordered]@{ Caption = [string]$os.Caption; Version = [string]$os.Version; BuildNumber = [string]$os.BuildNumber; ProductType = [int]$os.ProductType }",
    "}",
    "[Console]::Out.Write(($result | ConvertTo-Json -Depth 4 -Compress))",
  ].join("\n");
  const result = await runPowerShell(command, 30_000);
  if (result.code !== 0) throw new Error(result.stderr || result.stdout || "Windows runtime detection failed");
  let parsed;
  try {
    parsed = JSON.parse(result.stdout.trim());
  } catch {
    throw new Error("Windows runtime detection returned invalid JSON");
  }
  return {
    administrator: parsed.Administrator === true,
    commonApplicationData: String(parsed.CommonApplicationData || "").trim(),
    operatingSystem: parsed.OperatingSystem,
  };
}

function mutationsEnabled() {
  return IS_PACKAGED
    && !TEST_MODE
    && runtimeState.state === "ready"
    && runtimeState.administrator
    && runtimeState.secureRuntime
    && runtimeState.supportedWindows11
    && cleanupFailure === null;
}

function getRuntimePayload() {
  return {
    state: runtimeState.state,
    administrator: runtimeState.administrator,
    secureRuntime: runtimeState.secureRuntime,
    supportedWindows11: runtimeState.supportedWindows11,
    mutationsEnabled: mutationsEnabled(),
    packageVersion: PACKAGE_VERSION,
    windows: runtimeState.windows,
    ...(runtimeState.error ? { error: runtimeState.error } : {}),
  };
}

function initializeRuntime(options = {}) {
  if (runtimeInitialization) return runtimeInitialization;

  runtimeInitialization = (async () => {
    if (ELECTRON_PACKAGED_REQUESTED && !ELECTRON_RESOURCES_DIR) {
      throw new Error("Electron packaged runtime resources are unavailable");
    }
    if (TEST_MODE && options.dataDirectory) {
      if (!path.isAbsolute(options.dataDirectory)) throw new Error("Test runtime data directory must be absolute");
      CONFIG_DIR = path.resolve(options.dataDirectory);
    }

    const detected = TEST_MODE
      ? (options.runtimeInfo || { administrator: false, commonApplicationData: "", operatingSystem: null })
      : await detectRuntimeInfo();
    const windows = detected.operatingSystem ? normalizeWindowsInfo(detected.operatingSystem) : null;
    const supportedWindows11 = detected.operatingSystem ? isWindows11Workstation(detected.operatingSystem) : false;
    let secureRuntime = false;
    runtimeState = {
      ...runtimeState,
      administrator: detected.administrator === true,
      supportedWindows11,
      windows,
    };

    if (IS_PACKAGED) {
      if (!path.isAbsolute(detected.commonApplicationData || "")) {
        throw new Error("Unable to resolve the common application data directory");
      }
      CONFIG_DIR = path.resolve(detected.commonApplicationData, "Win11Optimizer");
      await ensureSecureRuntimeDirectory(CONFIG_DIR, detected.administrator === true);
      SCRIPTS_DIR = await extractPackagedScripts(
        path.join(ELECTRON_RESOURCES_DIR, "scripts"),
        path.join(CONFIG_DIR, "runtime"),
        detected.administrator === true,
      );
      secureRuntime = true;
    } else {
      await fs.promises.mkdir(CONFIG_DIR, { recursive: true });
    }

    runtimeState = {
      state: "ready",
      administrator: detected.administrator === true,
      secureRuntime,
      supportedWindows11,
      windows,
      error: null,
    };
    return getRuntimePayload();
  })().catch((error) => {
    runtimeState = {
      ...runtimeState,
      state: "error",
      secureRuntime: false,
      error: error.message || "Runtime initialization failed",
    };
    throw error;
  });

  return runtimeInitialization;
}

async function awaitRuntimeReady() {
  try {
    await initializeRuntime();
  } catch {
    throw new HttpError(503, runtimeState.error || "Runtime initialization failed");
  }
  if (runtimeState.state !== "ready") throw new HttpError(503, "Runtime initialization is not ready");
}

function runSingleFlight(key, task) {
  const current = inFlightTasks.get(key);
  if (current) return current;

  const promise = Promise.resolve().then(task).finally(() => {
    if (inFlightTasks.get(key) === promise) inFlightTasks.delete(key);
  });
  inFlightTasks.set(key, promise);
  return promise;
}

function runPS(script, args = [], timeoutMs) {
  return runPowerShell(buildScriptCommand(script, args), timeoutMs);
}

function normalizeOperationId(value) {
  if (value === undefined) return crypto.randomUUID();
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new HttpError(400, "Invalid operation id");
  }
  return value.toLowerCase();
}

function beginOperation(name, initialMessage, requestedId) {
  if (activeOperation) return null;
  const operation = { id: normalizeOperationId(requestedId), name };
  activeOperation = operation;
  execState = { operationId: operation.id, operation: name, running: true, phase: name, progress: 5, message: initialMessage, log: [], result: null };
  return operation;
}

function finishOperation(operation, code, message, result = null) {
  if (!activeOperation || activeOperation.id !== operation.id) return false;
  activeOperation = null;
  execState.running = false;
  execState.phase = code === 0 ? "done" : "error";
  execState.progress = code === 0 ? 100 : execState.progress;
  execState.message = message;
  execState.result = result ? { ...result, exitCode: code } : { exitCode: code };
  return true;
}

async function runExclusive(name, message, script, args = []) {
  const operation = beginOperation(name, message);
  if (!operation) throw new HttpError(409, `Another operation is running: ${activeOperation.name}`);
  try {
    const result = await runPS(script, args);
    appendLog(...result.stdout.split(/\r?\n/).filter(Boolean));
    if (result.stderr) appendLog(...result.stderr.split(/\r?\n/).filter(Boolean).map((line) => `[ERR] ${line}`));
    finishOperation(operation, result.code, result.code === 0 ? `${name} completed` : `${name} failed`);
    return result;
  } catch (error) {
    appendLog(`[ERR] ${error.message}`);
    finishOperation(operation, 1, `${name} failed`);
    throw error;
  }
}

async function serveStatic(req, res, url) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(url.pathname);
  } catch {
    throw new HttpError(400, "Invalid URL encoding");
  }

  const relativeRequest = urlPath === "/" ? "index.html" : urlPath.replace(/^[/\\]+/, "");
  let filePath = path.resolve(UI_DIR, relativeRequest);
  if (!isPathInside(UI_DIR, filePath)) throw new HttpError(403, "Forbidden");

  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, "index.html");
  } catch {
    throw new HttpError(404, "Not Found");
  }

  try {
    const content = await fs.promises.readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    const immutable = urlPath.startsWith("/_next/static/");
    res.writeHead(200, {
      ...securityHeaders(MIME[extension] || "application/octet-stream"),
      "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    });
    res.end(content);
  } catch {
    throw new HttpError(404, "Not Found");
  }
}

function validateSnapshotBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Invalid snapshot");
  if (typeof body.timestamp !== "string" || Number.isNaN(Date.parse(body.timestamp))) throw new HttpError(400, "Invalid timestamp");
  const configResult = validateConfig(body.config);
  if (!configResult.valid) throw new HttpError(400, `Invalid config: ${configResult.errors.slice(0, 3).join("; ")}`);
  const preset = body.preset === undefined ? body.config.preset : body.preset;
  if (typeof preset !== "string" || !SNAPSHOT_PRESETS.has(preset)) throw new HttpError(400, "Invalid snapshot preset");
  if (body.hardware !== undefined) {
    const hardwareErrors = [];
    validateHardware(body.hardware, hardwareErrors);
    if (hardwareErrors.length) throw new HttpError(400, `Invalid hardware: ${hardwareErrors.slice(0, 3).join("; ")}`);
  }
  return {
    timestamp: new Date(body.timestamp).toISOString(),
    preset,
    hardware: body.hardware,
    config: body.config,
  };
}

function timestampFilePart(timestamp, includeMilliseconds = true) {
  const iso = new Date(timestamp).toISOString();
  return iso.replace(/[:.]/g, "-").replace("T", "_").slice(0, includeMilliseconds ? 23 : 19);
}

function resolveChangesFile(fileName) {
  if (!/^changes_\d{8}_\d{6}(?:_[0-9a-f]{8})?\.json$/i.test(fileName)) throw new HttpError(400, "Invalid changes file");
  const resolved = path.resolve(CONFIG_DIR, fileName);
  if (!isPathInside(CONFIG_DIR, resolved) || !fs.existsSync(resolved)) throw new HttpError(404, "Changes file not found");
  return resolved;
}

function getManifestRecords(manifest, collection) {
  if (collection === "Registry") {
    if (Array.isArray(manifest.RegistryChanges)) return manifest.RegistryChanges;
    return Array.isArray(manifest.Changes) ? manifest.Changes : [];
  }
  if (collection === "Service") return Array.isArray(manifest.ServiceChanges) ? manifest.ServiceChanges : [];
  return Array.isArray(manifest.Operations) ? manifest.Operations : [];
}

function getRestoreAvailability(dataDirectory = CONFIG_DIR) {
  if (!fs.existsSync(dataDirectory)) return { available: false };

  const entries = fs.readdirSync(dataDirectory, { withFileTypes: true });
  const restorableChanges = entries
    .filter((entry) => entry.isFile() && /^changes_.*\.json$/i.test(entry.name))
    .map((entry) => {
      const manifest = JSON.parse(fs.readFileSync(path.join(dataDirectory, entry.name), "utf8"));
      const schemaVersion = Number(manifest.SchemaVersion);
      if (manifest.Tool !== "Win11Optimizer" || !Number.isFinite(schemaVersion) || schemaVersion < 2 || !manifest.SessionId) {
        throw new Error(`Unsupported or untrusted change manifest: ${entry.name}`);
      }

      const unrestoredCount = ["Registry", "Service", "Operation"]
        .flatMap((collection) => getManifestRecords(manifest, collection))
        .filter((record) => String(record?.Status) !== "Restored")
        .length;
      if (String(manifest.Status) === "Restored") {
        if (unrestoredCount > 0) throw new Error(`Inconsistent change manifest: ${entry.name}`);
        return null;
      }
      if (unrestoredCount === 0) return null;

      const createdAt = Date.parse(manifest.CreatedAt);
      if (Number.isNaN(createdAt)) throw new Error(`Invalid change manifest creation time: ${entry.name}`);
      return createdAt;
    })
    .filter((createdAt) => createdAt !== null);

  return { available: restorableChanges.length > 0 };
}

async function handleAPI(req, res, url) {
  authorizeAPI(req);

  if (req.method === "OPTIONS") {
    res.writeHead(204, { Allow: "GET, POST, DELETE, OPTIONS" });
    res.end();
    return;
  }

  if (url.pathname === "/api/status" && req.method === "GET") {
    const requestedOperationId = url.searchParams.get("operationId");
    if (requestedOperationId && requestedOperationId !== execState.operationId) {
      throw new HttpError(409, "Operation status is no longer available");
    }
    json(res, 200, execState);
    return;
  }

  if (url.pathname === "/api/runtime" && req.method === "GET") {
    json(res, 200, getRuntimePayload());
    return;
  }

  if (url.pathname === "/api/hardware" && req.method === "GET") {
    await awaitRuntimeReady();
    const modulePath = path.join(SCRIPTS_DIR, "utils", "HardwareDetect.psm1");
    const command = `$ErrorActionPreference='Stop'; $OutputEncoding=[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); Import-Module -Name ${quotePowerShell(modulePath)} -Force; Get-HardwareInfo | ConvertTo-Json -Depth 5 -Compress`;
    try {
      const result = await runSingleFlight("hardware", () => runPowerShell(command, 30_000));
      if (result.code !== 0) throw new Error(result.stderr || "Hardware detection failed");
      const raw = JSON.parse(result.stdout.trim());
      json(res, 200, {
        hasSSD: raw.HasSSD ?? raw.hasSSD ?? false,
        hasHDD: raw.HasHDD ?? raw.hasHDD ?? false,
        ramGB: raw.RAMGB ?? raw.ramGB ?? 0,
        cpuCores: raw.CPUCores ?? raw.cpuCores ?? 0,
        cpuName: raw.CPUName ?? raw.cpuName ?? "Unknown",
        gpuName: raw.GPUName ?? raw.gpuName ?? "Unknown",
        gpuBrand: raw.GPUBrand ?? raw.gpuBrand ?? "Unknown",
      });
    } catch (error) {
      json(res, 503, { error: "Hardware detection failed", detail: error.message });
    }
    return;
  }

  if (url.pathname === "/api/status/all" && req.method === "GET") {
    await awaitRuntimeReady();
    const modulePath = path.join(SCRIPTS_DIR, "modules", "SystemStatus.psm1");
    const command = `$ErrorActionPreference='Stop'; $OutputEncoding=[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); Import-Module -Name ${quotePowerShell(modulePath)} -Force; Get-SystemStatus | ConvertTo-Json -Depth 5 -Compress`;
    try {
      const result = await runSingleFlight("system-status", () => runPowerShell(command, 60_000));
      if (result.code !== 0) throw new Error(result.stderr || "Status detection failed");
      json(res, 200, JSON.parse(result.stdout.trim()));
    } catch (error) {
      json(res, 503, { error: "System status detection failed", detail: error.message });
    }
    return;
  }

  if (url.pathname === "/api/optimize" && req.method === "POST") {
    const body = await parseBody(req);
    if (body.restart === true) {
      assertMutationRuntime();
      if (activeOperation) throw new HttpError(409, "Cannot restart while an operation is running");
      await new Promise((resolve, reject) => {
        const restart = spawn(SHUTDOWN_EXE, ["/r", "/t", "5", "/c", "Restarting for optimization"], {
          env: buildChildEnvironment(),
          windowsHide: true,
          stdio: "ignore",
        });
        restart.once("error", reject);
        restart.once("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Unable to schedule restart (exit code ${Number.isInteger(code) ? code : "unknown"})`));
        });
      });
      json(res, 200, { message: "Restart scheduled in 5 seconds" });
      return;
    }

    const validation = validateConfig(body.config);
    if (!validation.valid) throw new HttpError(400, `Invalid config: ${validation.errors.slice(0, 5).join("; ")}`);
    normalizeOperationId(body.operationId);
    assertMutationRuntime();
    const operation = beginOperation("optimize", "Starting optimization...", body.operationId);
    if (!operation) throw new HttpError(409, `Another operation is running: ${activeOperation.name}`);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const configFile = path.join(CONFIG_DIR, `config_${timestamp}.json`);
    try {
      writeJsonAtomic(configFile, body.config);
      appendLog(`Configuration saved: ${configFile}`);
      const mainScript = path.join(SCRIPTS_DIR, "main.ps1");
      const processPromise = runPowerShell(
        buildScriptCommand(mainScript, ["-ConfigPath", configFile, "-AutoConfirm", "-LogDir", CONFIG_DIR]),
        OPTIMIZE_TIMEOUT_MS,
        {
          onStdout: (text) => {
            for (const line of text.split(/\r?\n/).filter(Boolean)) {
              appendLog(line);
              if (/backup|journal/i.test(line)) {
                execState.phase = "backup";
                execState.progress = Math.max(execState.progress, 15);
                execState.message = "Creating rollback journal...";
              } else if (/hardware/i.test(line)) {
                execState.phase = "detect";
                execState.progress = Math.max(execState.progress, 20);
                execState.message = "Detecting hardware...";
              } else if (/^.*(?:===|---)/.test(line)) {
                execState.progress = Math.min(execState.progress + 5, 90);
              }
            }
          },
          onStderr: (text) => {
            appendLog(...text.split(/\r?\n/).filter(Boolean).map((line) => `[ERR] ${line}`));
          },
        },
      );
      void processPromise.then(
        (result) => {
          finishOperation(
            operation,
            result.code,
            result.code === 0 ? "Optimization completed successfully" : "Optimization failed",
            { configFile },
          );
        },
        (error) => {
          appendLog(`[ERR] ${error.message}`);
          finishOperation(operation, 1, /timed out/i.test(error.message) ? "Optimization timed out" : "Optimization failed", { configFile });
        },
      );
    } catch (error) {
      finishOperation(operation, 1, "Unable to start optimization", { configFile });
      throw error;
    }

    json(res, 202, { message: "Started", operationId: operation.id });
    return;
  }

  if (url.pathname === "/api/backup" && req.method === "POST") {
    assertMutationRuntime();
    const result = await runExclusive("backup", "Creating backup...", path.join(SCRIPTS_DIR, "backup.ps1"), ["-OutputDir", CONFIG_DIR, "-LogDir", CONFIG_DIR]);
    json(res, result.code === 0 ? 200 : 500, { success: result.code === 0, output: result.stdout, error: result.code === 0 ? undefined : result.stderr });
    return;
  }

  if (url.pathname === "/api/restore/availability" && req.method === "GET") {
    await awaitRuntimeReady();
    json(res, 200, getRestoreAvailability());
    return;
  }

  if (url.pathname === "/api/restore" && req.method === "POST") {
    const body = await parseBody(req);
    assertMutationRuntime();
    let args;
    if (body.useSystemRestore === true) {
      args = ["-UseSystemRestore"];
    } else if (body.changesFile) {
      args = ["-ChangesJsonPath", resolveChangesFile(body.changesFile)];
    } else {
      if (!getRestoreAvailability().available) {
        json(res, 409, { success: false, code: "NO_RESTORE_RECORD", error: "No restorable optimization record was found" });
        return;
      }
      args = [];
    }
    args.push("-LogDir", CONFIG_DIR);
    const result = await runExclusive("restore", "Restoring system settings...", path.join(SCRIPTS_DIR, "restore.ps1"), args);
    json(res, result.code === 0 ? 200 : 500, { success: result.code === 0, output: result.stdout, error: result.code === 0 ? undefined : result.stderr });
    return;
  }

  if (url.pathname === "/api/uninstall" && req.method === "POST") {
    await awaitRuntimeReady();
    if (!getRestoreAvailability().available) {
      json(res, 409, { success: false, code: "NO_RESTORE_RECORD", error: "No restorable optimization record was found" });
      return;
    }
    assertMutationRuntime();
    const result = await runExclusive("uninstall", "Removing optimizer changes...", path.join(SCRIPTS_DIR, "uninstall.ps1"), ["-Confirm", "-LogDir", CONFIG_DIR]);
    json(res, result.code === 0 ? 200 : 500, { success: result.code === 0, output: result.stdout, error: result.code === 0 ? undefined : result.stderr });
    return;
  }

  if (url.pathname === "/api/snapshots" && req.method === "GET") {
    const files = fs.existsSync(CONFIG_DIR)
      ? fs.readdirSync(CONFIG_DIR).filter((name) => /^pre_optimize_[\d_-]+\.json$/i.test(name))
      : [];
    const snapshots = files.map((fileName) => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, fileName), "utf8"));
        const hardware = data.hardware || {};
        return {
          timestamp: data.timestamp,
          preset: data.preset,
          hardwareSummary: `${hardware.gpuName || "Unknown"} / ${hardware.ramGB || "?"}GB${hardware.hasSSD ? " / SSD" : ""}`,
          fileName,
        };
      } catch {
        return null;
      }
    }).filter(Boolean).sort((left, right) => String(right.timestamp).localeCompare(String(left.timestamp)));
    json(res, 200, snapshots);
    return;
  }

  if (url.pathname === "/api/snapshot" && req.method === "POST") {
    const snapshot = validateSnapshotBody(await parseBody(req));
    const fileName = `pre_optimize_${timestampFilePart(snapshot.timestamp)}.json`;
    writeJsonAtomic(path.join(CONFIG_DIR, fileName), snapshot);
    json(res, 200, { success: true, fileName });
    return;
  }

  const deleteMatch = url.pathname.match(/^\/api\/snapshots\/([^/]+)$/);
  if (deleteMatch && req.method === "DELETE") {
    let timestamp;
    try {
      timestamp = decodeURIComponent(deleteMatch[1]);
    } catch {
      throw new HttpError(400, "Invalid snapshot timestamp");
    }
    if (Number.isNaN(Date.parse(timestamp))) throw new HttpError(400, "Invalid snapshot timestamp");
    const candidates = [
      `pre_optimize_${timestampFilePart(timestamp, true)}.json`,
      `pre_optimize_${timestampFilePart(timestamp, false)}.json`,
    ];
    const target = candidates.map((name) => path.join(CONFIG_DIR, name)).find((filePath) => fs.existsSync(filePath));
    if (!target) throw new HttpError(404, "Snapshot not found");
    fs.unlinkSync(target);
    json(res, 200, { success: true });
    return;
  }

  throw new HttpError(404, "API endpoint not found");
}

async function handleRequest(req, res) {
  const localPort = authorizeLoopbackHost(req);
  const url = new URL(req.url || "/", `http://${HOST}:${localPort}`);

  if (url.pathname.startsWith("/api/")) {
    await handleAPI(req, res, url);
    return;
  }

  await serveStatic(req, res, url);
}

function createServer() {
  return http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const status = error instanceof HttpError ? error.status : 500;
      if (status >= 500) console.error("[server]", error);
      json(res, status, { error: error.message || "Internal server error" });
    });
  });
}

function openBrowser(sessionUrl) {
  if (process.platform !== "win32" || process.env.OPTIMIZER_NO_BROWSER === "1") return false;
  try {
    const opener = spawn(RUNDLL32_EXE, ["url.dll,FileProtocolHandler", sessionUrl], {
      detached: true,
      env: buildChildEnvironment(),
      windowsHide: true,
      stdio: "ignore",
    });
    opener.once("error", (error) => console.error("[browser]", error.message));
    opener.unref();
    return true;
  } catch {
    return false;
  }
}

function createCloseHandler(server) {
  let closePromise = null;
  return () => {
    if (closePromise) return closePromise;
    const closeServer = server.listening
      ? new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      })
      : Promise.resolve();
    closePromise = Promise.all([closeServer, terminateAllPowerShellTrees()]).then(() => undefined);
    return closePromise;
  };
}

function installShutdownHandlers(server, close) {
  let shuttingDown = false;
  const terminateOnExit = () => terminateAllPowerShellTreesSync();
  const removeHandlers = () => {
    process.removeListener("SIGINT", handleSigint);
    process.removeListener("SIGTERM", handleSigterm);
    process.removeListener("exit", terminateOnExit);
  };
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n  ${signal} received. Stopping active operations...`);
    void close().then(
      () => process.exit(0),
      (error) => {
        console.error("[shutdown]", error);
        process.exit(1);
      },
    );
  };
  const handleSigint = () => shutdown("SIGINT");
  const handleSigterm = () => shutdown("SIGTERM");

  process.once("SIGINT", handleSigint);
  process.once("SIGTERM", handleSigterm);
  process.once("exit", terminateOnExit);
  server.once("close", () => {
    if (!shuttingDown) removeHandlers();
  });
}

function startServer(options = {}) {
  const listenPort = options.port === undefined ? PORT : options.port;
  if (!Number.isInteger(listenPort) || listenPort < 0 || listenPort > 65535) {
    return Promise.reject(new Error("Server port must be an integer between 0 and 65535"));
  }
  const shouldOpenBrowser = options.openBrowser !== false;
  const shouldInstallShutdownHandlers = options.installShutdownHandlers !== false;
  const server = createServer();
  const close = createCloseHandler(server);

  return new Promise((resolve, reject) => {
    const handleError = (error) => reject(error);
    server.once("error", handleError);
    server.listen(listenPort, HOST, () => {
      server.removeListener("error", handleError);
      const address = server.address();
      if (!address || typeof address === "string") {
        void close();
        reject(new Error("Unable to determine the local server port"));
        return;
      }
      const actualPort = address.port;
      const sessionUrl = `http://${HOST}:${actualPort}/#session=${SESSION_TOKEN}`;
      if (shouldInstallShutdownHandlers) installShutdownHandlers(server, close);
      void initializeRuntime(options.runtime).catch((error) => console.error("[runtime]", error));

      console.log("\n  ====================================");
      console.log("   Windows 11 Gaming Optimizer");
      console.log("  ====================================");
      console.log(`\n  Listening on http://${HOST}:${actualPort}`);
      if (shouldOpenBrowser && !openBrowser(sessionUrl)) console.log(`  Open this session URL:\n  ${sessionUrl}`);
      console.log("");
      resolve({ server, port: actualPort, url: sessionUrl, sessionToken: SESSION_TOKEN, close });
    });
  });
}

if (require.main === module) {
  void startServer().catch((error) => {
    console.error("[startup]", error);
    process.exitCode = 1;
  });
}

module.exports = {
  get CONFIG_DIR() { return CONFIG_DIR; },
  SYSTEM_ROOT,
  get HAS_ADMIN_PRIVILEGES() { return runtimeState.administrator; },
  HOST,
  ICACLS_EXE,
  IS_PACKAGED,
  PACKAGE_VERSION,
  PORT,
  POWERSHELL_EXE,
  get SCRIPTS_DIR() { return SCRIPTS_DIR; },
  SESSION_HEADER,
  SESSION_TOKEN,
  SHUTDOWN_EXE,
  TASKKILL_EXE,
  TEST_MODE,
  get MUTATIONS_ENABLED() { return mutationsEnabled(); },
  get SECURE_RUNTIME() { return runtimeState.secureRuntime; },
  get SUPPORTED_WINDOWS_11() { return runtimeState.supportedWindows11; },
  assertMutationCapabilities,
  buildScriptCommand,
  buildChildEnvironment,
  createServer,
  getRuntimePayload,
  initializeRuntime,
  isPathInside,
  isWindows11Workstation,
  normalizeWindowsInfo,
  getRestoreAvailability,
  resolveChangesFile,
  runPowerShell,
  runSingleFlight,
  startServer,
  terminateAllPowerShellTrees,
};

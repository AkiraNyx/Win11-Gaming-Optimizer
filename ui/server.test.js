"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const POWERSHELL_TEST_TIMEOUT_MS = 15_000;

function request(port, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body ? JSON.stringify(options.body) : null;
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: pathname,
      method: options.method || "GET",
      headers: {
        ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}),
        ...options.headers,
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    req.once("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

async function waitForProcessExit(pid, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (isProcessRunning(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !isProcessRunning(pid);
}

test("backend safety behaviors", { timeout: 75_000 }, async (context) => {
  const serverSource = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
  assert.equal(fs.existsSync(path.join(__dirname, "fix-encoding.js")), false);
  const runtimeInfoStart = serverSource.indexOf("async function detectRuntimeInfo()");
  const runtimeInfoEnd = serverSource.indexOf("function mutationsEnabled()", runtimeInfoStart);
  assert.ok(runtimeInfoStart >= 0 && runtimeInfoEnd > runtimeInfoStart);
  const runtimeInfoSource = serverSource.slice(runtimeInfoStart, runtimeInfoEnd);
  assert.match(runtimeInfoSource, /\$OutputEncoding = \[Console\]::OutputEncoding = \[System\.Text\.UTF8Encoding\]::new\(\$false\);/);
  const rootSetOwner = serverSource.indexOf('[directory, "/setowner"');
  const rootReset = serverSource.indexOf('[directory, "/reset"');
  const rootInheritance = serverSource.indexOf('[directory, "/inheritance:r"');
  assert.ok(rootSetOwner >= 0 && rootSetOwner < rootReset && rootReset < rootInheritance);
  const contentsAclStart = serverSource.indexOf('const contents = path.join(directory, "*")');
  const contentsAclEnd = serverSource.indexOf("assertNoReparsePoints(directory);", contentsAclStart);
  const contentsAcl = serverSource.slice(contentsAclStart, contentsAclEnd);
  assert.match(contentsAcl, /S-1-5-32-544:F/);
  assert.match(contentsAcl, /"\/reset", "\/T"/);
  assert.doesNotMatch(contentsAcl, /inheritance:r/);
  assert.doesNotMatch(serverSource, /killer\.(?:stdout|stderr)\.on/);

  const invalidPort = spawnSync(process.execPath, ["-e", "require('./server')"], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: "3108abc",
      OPTIMIZER_NO_BROWSER: "1",
      WIN11OPT_TEST_MODE: "1",
    },
    encoding: "utf8",
    windowsHide: true,
  });
  assert.notEqual(invalidPort.status, 0);
  assert.match(invalidPort.stderr, /PORT must be an integer between 1 and 65535/);

  process.env.PORT = "1";
  process.env.OPTIMIZER_NO_BROWSER = "1";
  process.env.WIN11OPT_TEST_MODE = "1";
  process.env.SystemRoot = path.join(__dirname, "untrusted-system-root");
  process.env.WINDIR = path.join(__dirname, "untrusted-windir");
  process.env.SystemDrive = "Z:";
  process.env.ProgramFiles = "Z:\\Untrusted Program Files";
  process.env["ProgramFiles(x86)"] = "Z:\\Untrusted Program Files (x86)";
  process.env.USERPROFILE = "Z:\\Untrusted User";

  const app = require("./server");
  const runtimeDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "win11opt-runtime-"));
  context.after(() => fs.rmSync(runtimeDataDirectory, { recursive: true, force: true }));
  assert.equal(app.getRuntimePayload().state, "initializing");
  assert.equal(app.getRuntimePayload().packageVersion, app.PACKAGE_VERSION);
  await app.initializeRuntime({
    dataDirectory: runtimeDataDirectory,
    runtimeInfo: {
      administrator: true,
      commonApplicationData: runtimeDataDirectory,
      operatingSystem: {
        Caption: "Microsoft Windows 11 Pro",
        Version: "10.0.26100",
        BuildNumber: "26100",
        ProductType: 1,
      },
    },
  });
  const childEnvironment = app.buildChildEnvironment(runtimeDataDirectory);
  assert.equal(app.TEST_MODE, true);
  assert.equal(app.MUTATIONS_ENABLED, false);
  assert.equal(app.HAS_ADMIN_PRIVILEGES, true);
  assert.equal(app.SUPPORTED_WINDOWS_11, true);
  assert.notEqual(app.SYSTEM_ROOT, process.env.SystemRoot);
  assert.equal(childEnvironment.SystemRoot, app.SYSTEM_ROOT);
  assert.equal(childEnvironment.SystemDrive, path.parse(app.SYSTEM_ROOT).root.replace(/[\\/]$/, ""));
  assert.equal(childEnvironment.ProgramFiles, path.join(childEnvironment.SystemDrive, "Program Files"));
  assert.equal(childEnvironment["ProgramFiles(x86)"], path.join(childEnvironment.SystemDrive, "Program Files (x86)"));
  assert.equal(Object.hasOwn(childEnvironment, "USERPROFILE"), false);
  const expectedTestCachePath = path.win32.isAbsolute(process.env.PSModuleAnalysisCachePath || "")
    ? process.env.PSModuleAnalysisCachePath
    : undefined;
  assert.equal(childEnvironment.PSModuleAnalysisCachePath, expectedTestCachePath);
  assert.deepEqual(app.getRuntimePayload().windows, {
    caption: "Microsoft Windows 11 Pro",
    version: "10.0.26100",
    buildNumber: "26100",
    displayName: "Microsoft Windows 11 Pro 10.0.26100 (Build 26100)",
  });
  assert.equal(app.isWindows11Workstation({ BuildNumber: "22000", ProductType: 1 }), true);
  assert.equal(app.isWindows11Workstation({ BuildNumber: "21999", ProductType: 1 }), false);
  assert.equal(app.isWindows11Workstation({ BuildNumber: "26100", ProductType: 3 }), false);
  assert.equal(app.isWindows11Workstation({ BuildNumber: "invalid", ProductType: 1 }), false);
  assert.doesNotThrow(() => app.assertMutationCapabilities(true, true, true));
  assert.throws(() => app.assertMutationCapabilities(true, true, false), /Windows 11 client edition/);

  const restoreAvailabilityDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "win11opt-restore-availability-"));
  try {
    assert.deepEqual(app.getRestoreAvailability(restoreAvailabilityDirectory), { available: false });
    const changeManifestPath = path.join(restoreAvailabilityDirectory, "changes_20260803_120000.json");
    const changeManifest = {
      Tool: "Win11Optimizer",
      SchemaVersion: 2,
      SessionId: "test-session",
      CreatedAt: "2026-08-03T04:00:00.000Z",
      Status: "Completed",
      RegistryChanges: [],
      ServiceChanges: [],
      Operations: [],
    };
    fs.writeFileSync(changeManifestPath, JSON.stringify(changeManifest), "utf8");
    assert.deepEqual(app.getRestoreAvailability(restoreAvailabilityDirectory), { available: false });
    const appliedManifest = {
      ...changeManifest,
      RegistryChanges: [{ Status: "Applied" }],
    };
    fs.writeFileSync(changeManifestPath, JSON.stringify(appliedManifest), "utf8");
    assert.deepEqual(app.getRestoreAvailability(restoreAvailabilityDirectory), { available: true });
    fs.writeFileSync(changeManifestPath, JSON.stringify({
      ...appliedManifest,
      Status: "Restored",
      RegistryChanges: [{ Status: "Restored" }],
    }), "utf8");
    assert.deepEqual(app.getRestoreAvailability(restoreAvailabilityDirectory), { available: false });

    const backupName = "backup_20260803_120000";
    const backupDirectory = path.join(restoreAvailabilityDirectory, backupName);
    fs.mkdirSync(backupDirectory);
    fs.writeFileSync(path.join(backupDirectory, "backup_manifest.json"), JSON.stringify({
      Tool: "Win11Optimizer",
      SchemaVersion: 2,
      Kind: "PreApplyBackup",
      BackupId: backupName,
    }), "utf8");
    assert.deepEqual(app.getRestoreAvailability(restoreAvailabilityDirectory), { available: false });
  } finally {
    fs.rmSync(restoreAvailabilityDirectory, { recursive: true, force: true });
  }

  const suffixedJournalName = `changes_00000000_000000_${process.pid.toString(16).padStart(8, "0")}.json`;
  const suffixedJournalPath = path.join(app.CONFIG_DIR, suffixedJournalName);
  fs.writeFileSync(suffixedJournalPath, "{}", "utf8");
  try {
    assert.equal(app.resolveChangesFile(suffixedJournalName), path.resolve(suffixedJournalPath));
    assert.throws(() => app.resolveChangesFile("../changes_00000000_000000.json"), /Invalid changes file/);
  } finally {
    fs.unlinkSync(suffixedJournalPath);
  }

  await assert.rejects(
    app.startServer({ port: -1, openBrowser: false, installShutdownHandlers: false }),
    /between 0 and 65535/,
  );
  const startedServer = await app.startServer({ port: 0, openBrowser: false, installShutdownHandlers: false });
  const { port } = startedServer;
  assert.ok(Number.isInteger(port) && port > 0);
  assert.notEqual(port, app.PORT);
  assert.equal(startedServer.url, `http://${app.HOST}:${port}/#session=${app.SESSION_TOKEN}`);
  assert.equal(startedServer.sessionToken, app.SESSION_TOKEN);

  try {
    const unauthenticated = await request(port, "/api/status");
    assert.equal(unauthenticated.status, 401);

    const invalidHost = await request(port, "/", {
      headers: { Host: `example.invalid:${port}` },
    });
    assert.equal(invalidHost.status, 403);

    const authHeaders = { [app.SESSION_HEADER]: app.SESSION_TOKEN };
    const invalidApiHost = await request(port, "/api/status", {
      headers: { ...authHeaders, Host: `example.invalid:${port}` },
    });
    assert.equal(invalidApiHost.status, 403);

    const cookieOnly = await request(port, "/api/status", {
      headers: { Cookie: `win11opt_session=${app.SESSION_TOKEN}` },
    });
    assert.equal(cookieOnly.status, 401);

    const invalidOrigin = await request(port, "/api/status", {
      headers: { ...authHeaders, Origin: "http://example.invalid" },
    });
    assert.equal(invalidOrigin.status, 403);

    const validOrigin = await request(port, "/api/status", {
      headers: { ...authHeaders, Origin: `http://${app.HOST}:${port}` },
    });
    assert.equal(validOrigin.status, 200);

    const authenticated = await request(port, "/api/status", { headers: authHeaders });
    assert.equal(authenticated.status, 200);
    const initialStatus = JSON.parse(authenticated.body);
    assert.equal(initialStatus.operationId, null);
    assert.equal(initialStatus.operation, null);
    const mismatchedStatus = await request(port, "/api/status?operationId=00000000-0000-4000-8000-000000000000", { headers: authHeaders });
    assert.equal(mismatchedStatus.status, 409);
    const runtime = await request(port, "/api/runtime", { headers: authHeaders });
    assert.equal(runtime.status, 200);
    const runtimeBody = JSON.parse(runtime.body);
    assert.equal(typeof runtimeBody.administrator, "boolean");
    assert.equal(typeof runtimeBody.secureRuntime, "boolean");
    assert.equal(typeof runtimeBody.supportedWindows11, "boolean");
    assert.equal(runtimeBody.mutationsEnabled, false);
    assert.equal(runtimeBody.state, "ready");
    assert.equal(runtimeBody.packageVersion, app.PACKAGE_VERSION);
    assert.equal(runtimeBody.windows.buildNumber, "26100");

    const home = await request(port, "/");
    assert.equal(home.status, 200);
    assert.equal(home.headers["cache-control"], "no-cache");
    const assetPath = home.body.match(/src="([^\"]+\.js)"/)?.[1];
    assert.ok(assetPath, "built page should reference a JavaScript asset");
    const asset = await request(port, assetPath);
    assert.equal(asset.status, 200);
    assert.equal(asset.headers["cache-control"], "public, max-age=31536000, immutable");

    const missingAsset = await request(port, "/_next/static/missing.js");
    assert.equal(missingAsset.status, 404);

    const config = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", "presets", "balanced.json"), "utf8"));
    const invalidSnapshot = await request(port, "/api/snapshot", {
      method: "POST",
      headers: authHeaders,
      body: { timestamp: new Date().toISOString(), preset: "invalid", config },
    });
    assert.equal(invalidSnapshot.status, 400);

    const invalidPowerPlanConfig = structuredClone(config);
    invalidPowerPlanConfig.categories.powerManagement.items.ultimatePerformancePlan.target = "------------------------------------";
    const invalidPowerPlanSnapshot = await request(port, "/api/snapshot", {
      method: "POST",
      headers: authHeaders,
      body: { timestamp: new Date().toISOString(), preset: "balanced", config: invalidPowerPlanConfig },
    });
    assert.equal(invalidPowerPlanSnapshot.status, 400);

    const invalidOptimize = await request(port, "/api/optimize", {
      method: "POST",
      headers: authHeaders,
      body: { config: null },
    });
    assert.equal(invalidOptimize.status, 400);
    const invalidOperationId = await request(port, "/api/optimize", {
      method: "POST",
      headers: authHeaders,
      body: { config, operationId: "invalid" },
    });
    assert.equal(invalidOperationId.status, 400);
    const deniedMutation = await request(port, "/api/optimize", {
      method: "POST",
      headers: authHeaders,
      body: { config, operationId: "00000000-0000-4000-8000-000000000001" },
    });
    assert.equal(deniedMutation.status, 503);
    const emptyUninstall = await request(port, "/api/uninstall", {
      method: "POST",
      headers: authHeaders,
    });
    assert.equal(emptyUninstall.status, 409);
    assert.equal(JSON.parse(emptyUninstall.body).code, "NO_RESTORE_RECORD");
    const status = JSON.parse((await request(port, "/api/status", { headers: authHeaders })).body);
    assert.equal(status.running, false);
  } finally {
    await Promise.all([startedServer.close(), startedServer.close()]);
  }
  await assert.rejects(request(port, "/api/status"), /ECONN(?:REFUSED|RESET)/);

  const cleanupServer = await app.startServer({ port: 0, openBrowser: false, installShutdownHandlers: false });
  const interruptedPowerShell = app.runPowerShell("Start-Sleep -Seconds 30", 30_000);
  await new Promise((resolve) => setTimeout(resolve, 100));
  await cleanupServer.close();
  assert.notEqual((await interruptedPowerShell).code, 0);

  let taskCalls = 0;
  let releaseTask;
  const deferred = new Promise((resolve) => { releaseTask = resolve; });
  const flightKey = `test-${process.pid}`;
  const firstFlight = app.runSingleFlight(flightKey, () => {
    taskCalls++;
    return deferred;
  });
  const secondFlight = app.runSingleFlight(flightKey, () => {
    taskCalls++;
    return Promise.resolve("unexpected");
  });
  assert.strictEqual(firstFlight, secondFlight);
  assert.equal(taskCalls, 0);
  releaseTask("shared");
  assert.deepEqual(await Promise.all([firstFlight, secondFlight]), ["shared", "shared"]);
  assert.equal(taskCalls, 1);
  assert.equal(await app.runSingleFlight(flightKey, () => Promise.resolve("new")), "new");

  const normal = await app.runPowerShell("Write-Output 'ok'; exit 0", POWERSHELL_TEST_TIMEOUT_MS);
  assert.equal(normal.code, 0);
  assert.match(normal.stdout, /ok/);

  const unicodeCommand = [
    "$stream = [Console]::OpenStandardOutput()",
    "$bytes = [Text.Encoding]::UTF8.GetBytes('中文状态')",
    "foreach ($byte in $bytes) { $stream.WriteByte($byte); $stream.Flush(); Start-Sleep -Milliseconds 10 }",
  ].join("; ");
  const unicode = await app.runPowerShell(unicodeCommand, POWERSHELL_TEST_TIMEOUT_MS);
  assert.equal(unicode.code, 0);
  assert.equal(unicode.stdout, "中文状态");

  const unicodeJson = await app.runPowerShell([
    "$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    "$value = [ordered]@{ Caption = 'Microsoft Windows 11 专业版' }",
    "[Console]::Out.Write(($value | ConvertTo-Json -Compress))",
  ].join("; "), POWERSHELL_TEST_TIMEOUT_MS);
  assert.equal(unicodeJson.code, 0);
  assert.doesNotMatch(unicodeJson.stdout, /\uFFFD/);
  assert.equal(JSON.parse(unicodeJson.stdout).Caption, "Microsoft Windows 11 专业版");

  const streamScript = path.join(os.tmpdir(), `win11opt-streams-${process.pid}-${Date.now()}.ps1`);
  fs.writeFileSync(streamScript, [
    "Write-Output '[INFO] hello'",
    "Write-Host '[INFO] host line' -ForegroundColor Cyan",
    "Write-Warning 'native warning'",
    "Write-Information 'context line' -InformationAction Continue",
    "Write-Progress -Activity 'test' -Status 'working'",
    "Write-Error 'actual failure' -ErrorAction Continue",
    "exit 7",
  ].join("\r\n"), "utf8");
  try {
    const classified = await app.runPowerShell(app.buildScriptCommand(streamScript), POWERSHELL_TEST_TIMEOUT_MS);
    assert.equal(classified.code, 7);
    assert.match(classified.stdout, /\[INFO\] hello/);
    assert.match(classified.stdout, /\[INFO\] host line/);
    assert.match(classified.stdout, /\[WARN\] native warning/);
    assert.match(classified.stdout, /context line/);
    assert.match(classified.stdout, /\[ERR\].*actual failure/);
    assert.doesNotMatch(classified.stdout, /CLIXML|working/);
    assert.equal(classified.stderr, "");
  } finally {
    fs.unlinkSync(streamScript);
  }

  const startedAt = Date.now();
  await assert.rejects(app.runPowerShell("Start-Sleep -Seconds 30", 100), /timed out/);
  assert.ok(Date.now() - startedAt < 10_000);
});

test("PowerShell descendant cleanup baseline", { timeout: 25_000 }, async () => {
  const app = require("./server");
  let descendantPid = null;
  const quotedPowerShell = `'${app.POWERSHELL_EXE.replace(/'/g, "''")}'`;
  const descendantCommand = [
    `$child = Start-Process -FilePath ${quotedPowerShell} -ArgumentList '-NoProfile','-Command','Start-Sleep -Seconds 30' -PassThru`,
    "Write-Output ('DESCENDANT_PID=' + $child.Id)",
    "Wait-Process -Id $child.Id",
  ].join("; ");
  try {
    await assert.rejects(app.runPowerShell(descendantCommand, POWERSHELL_TEST_TIMEOUT_MS, {
      onStdout: (text) => {
        const match = text.match(/DESCENDANT_PID=(\d+)/);
        if (match) descendantPid = Number.parseInt(match[1], 10);
      },
    }), /timed out/);
    assert.ok(Number.isInteger(descendantPid));
    assert.equal(await waitForProcessExit(descendantPid), true);
  } finally {
    if (descendantPid && isProcessRunning(descendantPid)) {
      spawnSync(app.TASKKILL_EXE, ["/PID", String(descendantPid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      if (isProcessRunning(descendantPid)) {
        try { process.kill(descendantPid); } catch {}
      }
    }
  }
});

# Arinox UI regression check

Run `npm run build`, then `npm run test:ui` from `ui/`.

The check uses an existing Playwright installation and Microsoft Edge (channel `msedge`). If Playwright is outside this project, set `PLAYWRIGHT_MODULE_PATH` to its absolute package directory before running. No new browser or test dependency is installed automatically.

Set `EDGE_EXECUTABLE_PATH` when the existing Edge executable is not in Playwright's default channel location. The original 19 groups are retained. Additional checks cover seconds-based production motion tokens and exit duration, risk/preset payload retention, category scroll reset, theme reload/storage failures, and all-category/log access with corrupt configuration plus status/permission errors.

The complete suite now contains 45 groups. Its additional modules cover embedded dialog background isolation and focus return, state-dependent focus recovery, asynchronous import/copy feedback, titlebar and row/log hover corners, interrupted category/collapse/resize/theme motion, and reduced-motion changes while running. These fixture checks do not exercise real Windows optimization or recovery.

`node checks/electron-ui.mjs` opens an isolated Electron test window with the real preload/startup files, then closes it after verification. Set `ELECTRON_EXECUTABLE_PATH` to an existing Electron runtime. This harness never starts the optimizer main process or PowerShell service; its two static loopback previews return read-only fixtures. It verifies startup/error styling, focus, native theme writes, different localhost ports and an Electron restart. Artifacts go to `work/arinox-ui-fixes/native-check/`.

The test serves the production static export on an ephemeral loopback port. Every `/api/` request is intercepted with fixtures, including simulated optimization and snapshot writes; it never starts the optimizer service or modifies Windows. Browser storage is isolated and discarded when the test ends.

It checks day/night tokens, fonts, control radii, 14 categories, numeric selects, risky-switch confirmation, preset confirmation, JSON import/export, recovery/log dialogs, busy-modal closing guards, keyboard/focus, reduced motion, 390px overflow, readonly capabilities and malformed configuration preservation. It also checks repeated Current refreshes, recovery from an initial status failure, and log access at 1024x720 with multiple error banners. Screenshots go to `work/arinox-ui/` and contain test fixtures, not real hardware data.

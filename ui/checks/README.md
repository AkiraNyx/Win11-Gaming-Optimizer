# Arinox UI regression check

Run `npm run build`, then `npm run test:ui` from `ui/`.

The check uses an existing Playwright installation and Microsoft Edge (channel `msedge`). If Playwright is outside this project, set `PLAYWRIGHT_MODULE_PATH` to its absolute package directory before running. No new browser or test dependency is installed automatically.

The test serves the production static export on an ephemeral loopback port. Every `/api/` request is intercepted with fixtures, including simulated optimization and snapshot writes; it never starts the optimizer service or modifies Windows. Browser storage is isolated and discarded when the test ends.

It checks day/night tokens, fonts, control radii, 14 categories, numeric selects, risky-switch confirmation, preset confirmation, JSON import/export, recovery/log dialogs, busy-modal closing guards, keyboard/focus, reduced motion, 390px overflow, readonly capabilities and malformed configuration preservation. It also checks repeated Current refreshes, recovery from an initial status failure, and log access at 1024x720 with multiple error banners. Screenshots go to `work/arinox-ui/` and contain test fixtures, not real hardware data.

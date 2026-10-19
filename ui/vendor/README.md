# Arinox React source provenance

Local package: `arinox-react-0.1.1.tgz`

- Upstream: https://github.com/AkiraNyx/Arinox-React
- Source commit: [`76d17323c9c5d457496139cb0c0f6c56df95ced9`](https://github.com/AkiraNyx/Arinox-React/commit/76d17323c9c5d457496139cb0c0f6c56df95ced9)
- Historical source diff: [arinox-desktop.patch](arinox-desktop.patch) records the time-unit fix, shared Dialog focus repair, optional embedded mode and public motion tokens against the original 0.1.0 source. These changes are now included in upstream 0.1.1; do not reapply the patch to that version. The older duration-only patch and packaged LOCAL_PATCH.diff are retained for provenance.
- Synchronized: 2026-10-19
- Built with upstream `npm ci --ignore-scripts` and `npm run build:lib`, then `npm pack`.
- Public entry: `@arinox/react`; stylesheet: `@arinox/react/styles.css`.
- Arinox is GPL-3.0-only. The archive retains upstream LICENSE, LICENSES.md and original font license notices in lib/assets/fonts. The optimizer remains AGPL-3.0-only.
- Copies of the upstream license and font notices also live in `ui/public/licenses/arinox`, so Next static exports and packaged applications retain them. Paths inside NOTICES.md refer to the upstream source layout; the original texts are preserved beside it.

The archive is committed so npm ci works without a machine-specific cache or private registry. Refresh by rerunning the Arinox skill sync, building and packing the new source, replacing this archive, reinstalling it, and updating this commit marker. Matching package version alone does not establish matching source.

# Arinox React source provenance

Local package: `arinox-react-0.1.0.tgz`

- Upstream: https://github.com/AkiraNyx/Arinox-React
- Source commit: `d66db450d1709080afdef6e4a3c48309af819f1a`
- Synchronized: 2026-10-18
- Built with upstream `npm ci --ignore-scripts` and `npm run build:lib`, then `npm pack`.
- Public entry: `@arinox/react`; stylesheet: `@arinox/react/styles.css`.
- Arinox is GPL-3.0-only. The archive retains upstream LICENSE, LICENSES.md and original font license notices in lib/assets/fonts. The optimizer remains AGPL-3.0-only.
- Copies of the upstream license and font notices also live in `ui/public/licenses/arinox`, so Next static exports and packaged applications retain them. Paths inside NOTICES.md refer to the upstream source layout; the original texts are preserved beside it.

The archive is committed so npm ci works without a machine-specific cache or private registry. Refresh by rerunning the Arinox skill sync, building and packing the new source, replacing this archive, reinstalling it, and updating this commit marker. Matching package version alone does not establish matching source.

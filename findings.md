# Findings

## Debian first-install failure
- The reported /opt/devkit/chrome-sandbox.dpkg-new ENOENT matches the original data.tar.xz having no directory entries. The old verifier checked file metadata but did not enforce parent-directory presence/order; it incorrectly let this package pass static checks.
- Emit every parent directory before children, with root ownership and 0755 permissions; preserve runtime empty directories. A verifier must not use an extractor that silently creates missing parents, since that masks this defect. Strict empty-root extraction reproduces and prevents it.
- The actual old ARM64 archive now fails verification on its first entry due to missing opt/devkit. Eight packaging tests pass after the fix, with complete builder/extractor roundtrips on both architectures.
- Reissue as Debian 1.1.0-1 so a direct dpkg -i retry supersedes the old 1.1.0 package. No cleanup of /opt or replacement of OS libraries is needed for this specific error. Kylin launch and baseline dependency compatibility remain separate, unverified target checks.
- Actual rebuilt ARM64 revision passed strict empty-root extraction with 14 directories and 76 files, while preserving root:root ownership and 4755 sandbox metadata. SHA256SUMS matches the rebuilt artifact. Original defective deb is retained only under artifacts/legacy-deb for diagnosis, not transfer/install.

## Kylin V10 compatibility
- User screenshot: arm64, GTK 3.24.23, WebKitGTK 4.0 / JavaScriptCore 2.38.6 and libsoup 2.70.0. WebKitGTK 4.1 has no installed version/candidate. Target system libraries cannot be upgraded.
- Preserve the existing Tauri distribution and add a Kylin-specific Electron shell that bundles Chromium. Do not rename WebKit libraries, alter system repositories/libraries or disable the renderer sandbox.
- Use a secure local custom protocol for ES-module workers and lazy local resources, a narrowly scoped save-file IPC bridge, and an offline deb with no network install scripts. Validate actual ARM64 binary requirements before claiming compatibility.
- User subsequently requested a unified Electron architecture for both Windows and Linux. Active Tauri dependencies, native interfaces, source and CI were removed; residual build files/icons archived under ignored artifacts/legacy-tauri. Shared icons now live under build/icons.
- Electron 45.0.0 official ARM64 runtime ELF scan reports GLIBC 2.25 as its highest referenced glibc version across the bundled binaries. This is a static symbol check, not proof of target-machine compatibility.
- Generated v1.1.0 unified ARM64 deb (83.5 MiB) and Windows NSIS installer (~107 MiB). The deb contains Chromium, no WebKit dependency or system library replacements; only application files and a packaged Chromium sandbox helper are installed.
- Real Electron integration test passed: secure custom origin, sandbox/context isolation, renderer without Node, JSON UI, YAML/SQL lazy Worker modules, Web Crypto, save IPC writing UTF-8 and cancel. Native save dialog selection is mocked only in the test harness.

## v1.0 product upgrade
- Unified all 26 tools into seven task-oriented categories and a shared alias/fuzzy search index.
- Independent task state is memory-only; mounted editor instances preserve cursor/scroll on switching. Workers are keyed by task and cancellable; stale edits and failed reruns preserve prior output.
- Structured JSON results use an independently tokenized tree after grammar validation, preserving source number lexemes and duplicate fields. Preview limits bound main-thread work.
- Native save uses Tauri dialog + fs plugins with save and write-text-file commands only; user-selected file scope is supplied by the dialog plugin. No general filesystem scope was added.
- Verified production browser workflow: file import with 9007199254740993, JSON structured preview, duplicate task isolation, stale output retention, JSON-to-TypeScript routing, alias search, settings theme, workspace export excluding JWT by default, and restore into a fresh task.
- Rust check and formatting pass. All 56 tests pass. Generated Java compiles with the local IntelliJ JBR javac path; javac is not on PATH.
- First Windows release built successfully; native homepage startup and dark desktop layout inspected. Final revisions add navigation focus trapping and bounded workspace export.

- Workspace is empty and has no Git repository.
- Node.js, npm, pnpm, Rust, Cargo and Git are available on Windows.
- Linux build availability and native packaging requirements are being checked.
- No Docker or installed WSL distribution; Linux packages must be built on Linux CI/native machines.
- Visual Studio 2022 Community and Rust MSVC are present.
- User explicitly prefers Tauri for smaller packages.
- Tauri official Debian docs: bundle includes WebKitGTK/GTK dependencies; native runners avoid cross-linker complexity (https://v2.tauri.app/distribute/debian/).
- Tauri official workflow docs support native ARM runners (https://v2.tauri.app/distribute/pipelines/github/).
- UI guidance applied: controlled labeled fields, clear focus, local fonts, reduced motion; compact desktop layout with teal accent.
- Native Linux ARM runner label verified in GitHub official documentation: https://docs.github.com/en/actions/reference/runners/github-hosted-runners.
- Use Ubuntu 22.04 to keep glibc baseline lower; GTK/WebKit runtime packages are still required.
- JDK compiler is bundled at D:/Program Files/JetBrains/IntelliJ IDEA/jbr/bin/javac.exe; generated Java fixtures compile with --release 17.
- Type inference preserves original integer ranges; heterogeneous object arrays merge keys and optionality; TS results checked with the local TypeScript compiler.
- New tools reuse the existing worker and add no production dependency.
- Color suite: EyeDropper is environment-dependent; feature-detect it and retain native color input + local image canvas sampling on all supported platforms (https://developer.mozilla.org/en-US/docs/Web/API/EyeDropper_API).
- WCAG 2.2 contrast uses sRGB linearization threshold 0.04045 and unrounded AA/AAA decisions (https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum).
- Native image blob URLs require blob: in img-src CSP; added for local image decoding.
- UI refinement uses CodeMirror 6 basicSetup, controlled-state synchronization and language compartments. Editor and JSON/TS/Java/CSS parsers are loaded as local lazy chunks (https://codemirror.net/examples/basic/).
- Tab indentation includes the documented Esc-then-Tab escape hatch (https://codemirror.net/examples/tab/).

- Official yaml, jsdiff and sql-formatter APIs reviewed: https://eemeli.org/yaml/ ; https://github.com/kpdecker/jsdiff ; https://github.com/sql-formatter-org/sql-formatter . Use bounded aliases/diffs and local lazy imports.

- With Vite worker.format='es', final worker entry is ~27.5kB; YAML ~97.2kB, SQL ~263.8kB and diff ~12.2kB load as separate local worker chunks. Production CSP conversion tests passed.

## v1.2 inspection
- Current unified Electron version 45.0.0 and app 1.1.0. Cross-packaging Linux deb from Windows is supported by existing Python scripts.
- Existing packaging regression requires parent-first directory metadata, strict empty-root extraction, ELF architecture/glibc checks and sandbox permissions.
- Entire project is untracked in existing Git repository; preserve all files and do not reset checkout.

## v1.2 delivery findings
- Official Electron v45.0.0 Linux x64 archive SHA-256: 22f6a10bd3f7fef987ddbb379d3375ce664ad0c98a9a50f80c89f1718a0c3e3a, checked against GitHub release SHASUMS256.txt.
- Both actual Linux deb archives retain 14 parent-first directories, 76 files and the 4755 root-owned sandbox helper. Static maximum required GLIBC is 2.25 on amd64 and ARM64; target machine execution is still unverified.
- All three app.asar manifests are 1.2.0 and index.html matches current dist; release SHA-256 matches all three copied packages.

## Type conversion follow-up
- Preserve old JSON generator engines through legacy transform compatibility, while the visible catalog contains json-code and type-json only.
- Java-parser 3.0.1 may parse nested Record members as methods returning record; safe top-level declaration reparse corrects this and preserves source locations.
- Parser dependencies are lazy local chunks and run successfully under existing Electron CSP without unsafe-eval. lodash/lodash-es patched compatible overrides are needed for zero known dependency advisories.

## GitHub research (2026-10-24)
- Baseline: DevKit 1.3.0, 38 tools, 97 core tests; all files already untracked, preserve checkout.
- DevToys official repo https://github.com/DevToys-app/DevToys lists smart detection, XML, GZip, text analysis and extensions.
- IT-Tools official registry https://github.com/CorentinTh/it-tools/blob/main/src/tools/index.ts includes ULID, XML, network tools and converters. GPL-3.0; compare capabilities without copying code.
- CyberChef official repo https://github.com/gchq/CyberChef emphasizes composable data transformations and compression. Reuse existing send-result workflow and add content recommendations.


## v1.4 implementation findings
- Six tools added, 44 total. XML formatter and CodeMirror XML are lazy local dependencies; GZip uses native Compression Streams in Workers.
- Existing discovery ranked description mentions as highly as aliases, causing ULID's negative token warning to outrank JWT. Prioritize explicit aliases over prose.
- 117 core tests, 3 desktop checks, 2 release integrity tests, 8 Debian regressions and 4 generated Java compilations pass. Source Electron smoke passes new tools and recommendations.
- XML formatting may normalize whitespace; it is not a lossless converter or schema validator. GZip limited during stream reading, with independent Node zlib checks.
- ASAR extraction on Windows requires native path separators; corrected verifier after real-archive regression exposed this.
- Electron minWidth=800 prevented a 390px test viewport. Adjust only the test window minimum and assert actual viewport width before capturing responsive proof.

- Final v1.4 packages: Windows 112936325 bytes, amd64 93153586 bytes, ARM64 88053710 bytes. Shared build fingerprint 8115fee70a3179903ac8eeebd3b25287e1e52e54d8aa36770687c7305e71ec0a. Independently read final deb payloads; both application ASARs hash to 9bd3bf7edfdfcc2c60bf031bb657500e7d2e587fac79b93dba05e6ff6bd1b196 and match verified runtimes.
- A final metadata-only dependency declaration changed frontend asset names because App imports the package manifest. Integrity collection correctly rejected it. Restored the existing locked dependency graph, rebuilt and successfully recollected identical verified assets. Future optimization: isolate the app version constant from build metadata.


## home reference inspection (requested review only)
- Reference is LaunchPad, Vue/Pinia frontend + Express local backend. Actual App has service entries, Nginx, environment profiles, runtime state, backups and toolbox workspaces.
- Toolbox registry has 36 entries including Nginx location generation; excluding that leaves 35 non-Nginx tool entries. Verify count and detailed runtime-backed capabilities before reporting.
- Newly relevant gaps: TOML, OpenAPI, JSON Schema validation, Mock generation, structured JSON diff, Base32/Base58/Hex/ASCII, cURL parsing, HTTP client, port occupancy, table/CSV cleaning, SQL INSERT conversion, CSS layout, ENV comparison, gitignore and Compose snippets.
- User explicitly requests inventory first; do not implement or rebuild this turn.

- Confirmed registry count: 36 toolbox entries, 35 after removing nginx-location. Core modules outside Nginx remain service entries, config management, environment profiles, runtime state and config backup/restore.
- HTTP implemented types support GET/POST/PUT/PATCH/DELETE/HEAD, none/json/text bodies, Bearer/Basic/API Key, cookies, variables, assertions, collections/history and response comparison.
- Practical backend has preflight/environment/migration/delivery endpoints, but current Vue components only call practicalStore.scanPorts. Treat these separately as backend-only and omit Nginx-coupled parts from suggested visible functionality.

- Inventory saved as docs/home-feature-inventory.md: all 35 visible non-Nginx tools, project-level modules, HTTP details, API-only utilities and current DevKit gaps.
- Found migration caveats: enum detection option not consumed by entity inference; ref label needs semantic review; Linux port inspection lacks PID/process data; frontend Ajv dynamic compilation needs strict Electron CSP adaptation. No reference runtime tests or network actions performed.


## Project center implementation
- User selected LAN exposure for project center only. Added shared model: global project definitions plus per-user-selected environment profiles/variables and per-project overrides; no Nginx schema.
- Host store serializes versioned writes, rejects stale revisions, atomically saves current state + thirty snapshots together, uses a per-data-directory process lock, and preserves corrupt originals.
- HTTP server serves only portal build-manifest dependency closure. Password sessions, readonly default, origin/Host checks and write permissions are separate from Electron-only sharing/file capabilities. Shared server/model use only Node built-ins.
- Eight project/storage/HTTP regression checks pass; existing 117 core, 3 desktop and 2 integrity tests pass. Source Electron UI check running. Fixed test-helper quoting; then found the conflict test clicked save before async refresh completed, now waits for enabled controls.

- All final source and packaged Windows ASAR Electron flows pass, including real project portal browser login and blocked desktop JS/Worker routes. Desktop, light web portal and narrow dark portal visually inspected.
- Created standalone project-only ZIP using the portal manifest closure: no desktop entry, workers, node_modules or user data. Actual extracted Node process serves all portal assets, cookie login works, readonly writes are refused and desktop entry is 404. Host Node required, clients browser-only.

- v1.5 delivery: Windows x64 112957599 bytes, Linux amd64 93167198 bytes, Linux ARM64 88070658 bytes, standalone Node24 ZIP 103644 bytes. Three desktop builds share fingerprint 3909e24172a0f68a42e55af72931571b8722e482b98df7f05035ea66dd03df84. Final deb ASARs independently match runtime (40039deff27dae2a734374fe27470511a1b4785a6ab29a23fa78d2410cdfbf03).
- Electron/get refreshes SHASUMS even for cached archives. A GitHub timeout was recovered without skipping integrity: validated cached ARM64 ZIP against already downloaded official SHASUMS, then used packager electronZipDir. Release and per-package verification passed; details recorded in artifacts/verification-1.5.0.md.

## Project center refinement request
- User requires installed executable directory/configs as the authoritative portable data directory, with folder-copy transfer and JSON import/export. Existing implementation uses Electron userData/project-center and Node data/project-center; both need migration.
- Current UX issues: destructive native confirms, no dirty-dismiss guard, bulk actions target all filtered projects without explicit selection, no sorting/list view, cramped unlabeled parameter rows and preview has no URL component explanation. Existing conflict draft retention should be preserved.
- Linux /opt/devkit is root owned; need deliberate install-time ownership for configs rather than silently falling back to another directory or running the app as root. Folder-copy locks must be portable across machines.
- Implemented install-local data and first-start migration with both source and snapshots preserved. Existing configs always win. Folder-copy tests include a foreign-host lock with a live local PID; it recovers correctly without affecting same-host active-lock rejection.
- UI visual review: desktop/light portal are clear; mobile profile details consumed too much of the first screen. Condensed mobile profile buttons/hints, removed redundant backup text there, and changed mobile filters to three columns. Keep desktop cards/list and modal controls unchanged.
- Actual isolated NSIS harness executes the production cleanup macro and verifies nested configs bytes survive both simulated upgrade and uninstall, while all fixture runtime files are removed. No real installation or registry changed.
- v1.6 final desktop packages share source/runtime fingerprint 1e7038a67729215c5f46f35a5e38fbb9f283d2aa6a05dc69119891df650eba1e. Windows 112966906 bytes, amd64 93179028 bytes, ARM64 88079948 bytes, portable ZIP 116279 bytes. All final checksums verified.
- Configs-only transfer into a clean standalone installation works even when launched from a different CWD. Password env was omitted on restart to prove copied sharing settings are used. Same-host stale lock recovered after test process shutdown; projects and snapshots retained. Final compact cards measured 150 CSS px including description.


# Toolkit implementation plan

## Goal
Build an offline cross-platform developer desktop toolkit, with Windows exe and Linux arm64/amd64 deb packaging.

## Phases
1. Inspect environment and confirm packaging architecture — complete
2. Implement desktop shell, tool engine and usable interface — complete
3. Add automated verification and multi-platform packaging workflow — complete
4. Build available local artifacts, verify interface and document delivery — complete
5. Add JSON → Java / TypeScript generators and more offline utilities — complete
6. Verify generated code, refresh UI and rebuild Windows artifacts — complete
7. Add visual color-management suite: picker, conversion, palettes, gradients, contrast and mixing — complete
8. Test color math and UI interactions, refresh documentation and rebuild Windows — complete
9. Refine design system, overview, navigation, command search and editor workspaces — complete
10. Verify light/dark themes and responsive interactions, document and rebuild Windows — complete
11. Add six practical offline tools with focused parsing and generation tests — complete
12. Verify production UI, update documentation and rebuild Windows v0.5.0 — complete
13. Product-level v1.0: task-oriented taxonomy, compact visual system and interaction design — complete
14. Implement multi-task workspaces, file workflows, settings and structured result views — complete
15. Verify user flows, accessibility, regression and Windows delivery — complete
16. Migrate all desktop targets to one Electron shell with bundled Chromium; remove active Tauri dependencies and build paths — complete
17. Build and inspect the ARM64 deb and Windows Electron package, test the isolated desktop bridge and document offline validation — complete
18. Fix missing Debian archive parent directories and add strict extraction regression tests — complete
19. Rebuild corrected ARM64 Debian revision, verify the actual artifact and document retry steps — complete

## Delivery status
- User's first Kylin install exposed missing directory entries in the original 1.1.0 deb. The old verifier missed this packaging defect. Rebuilt ARM64 revision 1.1.0-1 with 14 parent-first directories and 76 files, verified strict extraction into an empty root, root ownership and 4755 sandbox permissions. Eight packaging tests, 56 core tests and 3 desktop policy tests pass. SHA256SUMS and offline instructions refreshed; defective original moved to artifacts/legacy-deb. Actual Kylin retry/startup remains pending.
- v1.1.0 unifies all targets on Electron 45.0.0. Windows x64 NSIS (~107 MiB) and Linux ARM64 deb (83.5 MiB) generated. ARM64 archive audited: AArch64 executable, no WebKit dependency or system library files, preserved root-owned Chromium sandbox helper, highest glibc symbol requirement 2.25. 56 core tests, 3 desktop policy tests, generated Java fixtures and real Electron integration checks pass, including checks against the packaged Windows ASAR. Actual Kylin installation/startup and installer execution remain unverified on this Windows host.
- v1.0.0 product upgrade delivered: seven task categories, independent tasks, modern workbench UI, settings, file workflows and structured results. 56 tests plus frontend/Rust checks and generated Java compilation pass. Windows EXE/NSIS and versioned SHA-256 checksums are in artifacts/windows-x64. Verification details and native-dialog automation limitation are recorded in artifacts/v1-verification.md. Linux execution and system installation remain environment-dependent.
- v0.5.0 adds six practical offline tools (26 total); 45 tests and production UI checks pass. Windows installer/exe rebuilt, checksums refreshed and native startup smoke check passed.
- Windows exe and NSIS installer built successfully and copied to artifacts/windows-x64.
- Native exe startup smoke check passed. Nine core tests and frontend type/build checks passed.
- Linux amd64/arm64 build matrix configured; actual deb artifacts remain dependent on a Linux runner. No remote repository is configured, so these jobs have not been executed here.
- v0.2.0 extends to 14 tools. 24 tests pass; generated TS typechecks and 4 generated Java fixtures compile with Java 17. Windows installer rebuilt and copied to artifacts/windows-x64.
- v0.3.0 extends to 20 tools with six visual color tools. 35 tests pass; image pixel sampling, palette persistence/copy, gradients, contrast and themes verified. Windows bundle rebuilt with local blob image CSP support.
- v0.4.0 refines the app shell, overview, command search and editor workspaces; 35 tests and production UI checks pass. Windows installer rebuilt; screenshots saved under artifacts/preview-ui-*.png.

## Decisions
- User-selected stack: Tauri 2, React, TypeScript and Vite; prioritize small distribution size.
- Default language: Simplified Chinese; offline processing.
- Initial tools: JSON, encodings, timestamps, hash, UUID and regular expressions.
- Follow-up: prioritize JSON → Java and TypeScript; add JSON → CSV, JWT decoding, radix conversion, text transforms and HTML entity conversion (14 tools total).

## Errors
- Follow-up plan patch included an incorrect progress.md anchor; split into a targeted plan patch and appended log entry.
- A combined CodeEditor move/add patch was rejected as duplicate path; split the move and wrapper creation into sequential patches.
- Previous preview handle/server did not survive between turns; reacquired browser tab and restarted the local Vite dev server.
- Browser scroll used coordinates from an older, wider viewport; refreshed screenshot and used keyboard navigation for the narrow preview.
- New all-sample smoke test omitted existing regex options; corrected it to use the UI's centralized default options.
- TypeScript inferred literal `false` for the theme preference; fixed by explicit boolean generic.
- A dev-server attempt overlapped dependency replacement and found no Vite executable; wait for install completion before rerunning.
- Visual review found root text color did not inherit the dark theme variable; fixed root color inheritance.
- First Rust release build succeeded (3,151,360-byte exe); NSIS helper DLL download ended unexpectedly. Inspect official download/cache and retry bundling after correcting dependency download.

- Additional UI patch used a partial single-line JSX anchor; corrected to exact lines. Session catchup unavailable because Windows python is an uninstalled Store alias; restored context from project planning files.

- New tool count invalidated the old 20-tool assertion; updated to 26. TypeScript rejected heterogeneous invalid-option fixtures with optional undefined properties; added the explicit Options[] fixture type.

- Starting a duplicate preview server reported port 1421 already in use; reused the existing production server successfully.

- Rebuilding dist removed old hashed worker assets while a preview page stayed open; reloaded the final build and repeated diff successfully. CUA contenteditable fill timed out; used native select-all and paste, then verified controlled state and Ctrl+Enter.

- Initial export click showed the UI notice but no Downloads file; used the documented download-event waiter, then verified the actual returned file path and content.

## 2026-10-24 v1.2 developer tools upgrade
20. Implement twelve offline frontend/backend tools and integrate catalog/options/editor/export — complete
21. Add edge-case regression and real Electron worker/UI verification — complete
22. Build Windows x64, Linux x64 and Linux ARM64 packages, verify archives/checksums and update docs — complete



## 2026-10-24 unified type conversion
23. Merge JSON-to-Java/TS with language-specific options and migrate old workspace/preferences IDs — complete
24. Add safe Java/TS type-to-JSON sample generation with parsers, limits, cycle handling and tests — complete
25. Verify UI/worker, refresh documentation and all three architecture packages — complete



## 2026-10-24 GitHub research and v1.4 delivery
26. Compare established GitHub toolkits and prioritize gaps — complete
27. Implement selected offline tools and explicit content recommendations — complete
28. Run regression, Electron integration and improve release verification — complete
29. Package Windows x64 / Linux amd64 / Linux ARM64 and deliver research report — complete

- Session catchup: Python Store alias unavailable; restored context from existing plan, progress and findings.


## v1.4 delivery complete
- 44 offline tools, explicit content recommendations and improved search. All three actual packages collected under artifacts/release-1.4.0, checksums and shared source/runtime fingerprint verified. Research, installation and verification documents included. Linux/Kylin execution and Windows installer execution remain target-machine checks.

## home project reference inventory
30. Inspect home source, enumerate non-Nginx functions and compare with DevKit — complete
31. Present inventory for user selection before implementation — complete
- Scope: read-only reference inspection; no functionality implementation or packaging in this review turn.


## Integrated project center and LAN portal
32. Design shared project definitions, environment profiles, safe persistence and conflict handling — complete
33. Build desktop project center and authenticated project-only browser portal — complete
34. Verify domain/storage/LAN boundaries and actual desktop/browser workflows — complete
35. Document host/client setup, package Windows x64 + Linux amd64 + ARM64 — complete
- User selected project-center-only LAN exposure; existing toolkit is not exposed. No Nginx features.

## Project center refinement and portable configs
36. Audit entry/profile/backup flows and define a clearer responsive management UI — complete
37. Store configs beside the installed executable, migrate legacy data safely, support folder transfer and permissions — complete
38. Refine URL validation/previews, editing safety, selection/actions, import/restore workflows and desktop/browser parity — complete
39. Verify real UI, migration/transfer/permissions and regressions, update deployment docs — complete
40. Build and verify Windows x64, Linux amd64/ARM64 and portable server release — complete


# DevKit v1.0

## Product direction
An offline desktop workbench for repeat developer tasks. Existing 26 tools remain the functional foundation. The upgrade prioritizes coherent navigation, task continuity and purposeful layouts.

## Information architecture
One primary category per tool: structured data; code and queries; encoding and parsing; text and matching; time and numbers; security and identifiers; colors and design. Favorites, recent tools and open tasks are independent navigation views. Search shares aliases and ranking everywhere.

## Visual system
Local system sans-serif for Chinese and UI; Cascadia Code / Consolas for code. Emerald accent, neutral surfaces, fine borders, restrained shadows, 8–12px radii. Compact 56px application header, 232px navigation, horizontal task strip, 24px workspace padding. Light, dark and system themes. No remote fonts or resources.

## Key screens
- Home: workbench title, search, resume tasks, category filters and grid/list tool library. No marketing hero.
- Transform: compact heading, parameter bar, resizable input/output split, explicit execution state, file import/export and send-to-tool action.
- Analyze: same shell with optional structured JSON, URL, JWT and regex results; raw text remains available.
- Color: live preview, shared color collection, preserved per-task visual state while switching tasks.
- Settings: appearance, editor preferences, startup, data export/import and documented shortcuts.

## Interaction contract
Opening a tool reuses its existing task; explicit New task creates another instance. Switching tasks preserves editor instances, cursor, scroll and draft. Running work can finish in the background or be cancelled. Editing preserves the last output with a stale marker. Failed reruns preserve the last successful result. Clear can be undone. Closing a task can be undone.

## Privacy and persistence
Only validated preferences and favorites persist automatically. Inputs and outputs remain in memory. Workspace files are explicitly saved and contain text task data; passwords and JWTs are excluded by default. Imported workspace files are validated and bounded. Images are never embedded in snapshots. No telemetry or background network access.

## Acceptance
All existing algorithm tests pass. Add meaningful coverage for search, task transitions and untrusted workspace import. Verify production UI in light/dark, desktop/narrow sizes, keyboard search, independent duplicate tasks, cancellation, stale output, file import, structured result views and save/restore. Build frontend, generated Java fixtures and Windows package. Linux execution requires a Linux runner.

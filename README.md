# Axon project tracker

This static HTML tracker manages project expenses, categories, receipts, allocations, construction tasks, dashboards, and workbook notes. Open `index.html` in a browser to use it.

## Projects and shared data

The landing page lists projects, creates new projects, and opens the existing tracker features for the selected project. Existing data in browser storage and the Supabase row with ID `main` are retained and shown as **Prem residence**. New projects use the same features with their own independent data.

Project records are stored in the `public.project_data` Supabase table, one row per project. The existing `main` row is not renamed or deleted. If it is absent, the app initializes it from the legacy browser-storage keys and inserts it without overwriting an existing row. New project data is stored locally per project and synced to that project's row.

The local project cache and project directory are stored in IndexedDB so projects with receipt or workbook images are not limited by the much smaller localStorage quota. Existing localStorage project keys are migrated on first open only after the IndexedDB write succeeds; the original keys are retained. If the browser cannot save the local cache, the app reports the error and does not clear or truncate existing data. If a cloud save succeeds despite a local-cache failure, export a JSON backup before closing the tab.

For cross-device sharing, the configured Supabase project must have a readable/writable `project_data` table with `id` as its text primary key, `payload` as JSONB, and `updated_at` as a timestamp. The configured anonymous client needs the applicable SELECT, INSERT, and UPDATE permissions, and `project_data` must be enabled for Supabase Realtime. If these permissions or Realtime are unavailable, the app indicates that cloud sync failed and retains the data locally.

Use **Sync now** in the project header to refresh the project list and active project's cloud data. Changes saved while offline or after a failed cloud write are marked as pending locally and uploaded when sync is retried or connectivity returns. The app stores each project's full data in one row, so simultaneous edits to the same project from multiple devices are last-write-wins; sync is not a field-level merge or conflict-resolution system.

This retains the app's existing shared anonymous access model; it does not add sign-in or member-specific permissions. Anyone able to use the configured anonymous client may be able to read or change project rows, depending on the table's Row Level Security policies. Review those policies before using the app for data that must be private.

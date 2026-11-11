# Axon project tracker

This static HTML tracker manages project expenses, categories, receipts, allocations, construction tasks, dashboards, and workbook notes. Open `index.html` in a browser to use it.

## Projects and shared data

The landing page lists projects, creates new projects, and opens the existing tracker features for the selected project. Existing data in browser storage and the Supabase row with ID `main` are retained and shown as **Prem residence**. New projects use the same features with their own independent data.

Project records are stored in the `public.project_data` Supabase table, one row per project. The existing `main` row is not renamed or deleted. If it is absent, the app initializes it from the legacy browser-storage keys and inserts it without overwriting an existing row. New project data is stored locally per project and synced to that project's row.

For cross-device sharing, the configured Supabase project must have a readable/writable `project_data` table with `id` as its text primary key, `payload` as JSONB, and `updated_at` as a timestamp. The configured anonymous client needs the applicable SELECT, INSERT, and UPDATE permissions, and `project_data` must be enabled for Supabase Realtime. If these permissions or Realtime are unavailable, the app indicates that cloud sync failed and retains the data locally.

This retains the app's existing shared anonymous access model; it does not add sign-in or member-specific permissions. Anyone able to use the configured anonymous client may be able to read or change project rows, depending on the table's Row Level Security policies. Review those policies before using the app for data that must be private.

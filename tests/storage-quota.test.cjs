const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('  function openLocalDatabase()');
const end = html.indexOf('  async function clearPendingChanges(', start);
assert.notEqual(start, -1, 'IndexedDB persistence code should exist in index.html');
assert.notEqual(end, -1, 'IndexedDB persistence code should have a clear end marker');
const persistenceCode = html.slice(start, end);

function createIndexedDB({ failWrites = false } = {}) {
  const stores = new Map();
  let writeCount = 0;
  let shouldFailWrites = failWrites;
  const indexedDB = {
    open() {
      const request = {};
      queueMicrotask(() => {
        const db = {
          objectStoreNames: { contains: name => stores.has(name) },
          createObjectStore(name, options) {
            stores.set(name, { keyPath: options.keyPath, values: new Map() });
          },
          transaction(name) {
            const store = stores.get(name);
            const transaction = { error: null };
            transaction.objectStore = () => ({
              get(key) {
                const readRequest = {};
                queueMicrotask(() => {
                  readRequest.result = store.values.get(key) || null;
                  readRequest.onsuccess?.();
                });
                return readRequest;
              },
              put(record) {
                writeCount++;
                queueMicrotask(() => {
                  if (shouldFailWrites) {
                    transaction.error = Object.assign(new Error('Simulated IndexedDB quota failure'), { name: 'QuotaExceededError' });
                    transaction.onabort?.();
                    return;
                  }
                  store.values.set(record[store.keyPath], structuredClone(record));
                  transaction.oncomplete?.();
                });
              }
            });
            return transaction;
          }
        };
        request.result = db;
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    }
  };
  return {
    indexedDB,
    getRecord(store, key) {
      return stores.get(store)?.values.get(key) || null;
    },
    setFailWrites(value) { shouldFailWrites = value; },
    get writeCount() { return writeCount; }
  };
}

function createLocalStorage(initialValues) {
  const values = new Map(Object.entries(initialValues));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

function createContext({ legacyExpenses, failWrites = false, dirty = false }) {
  const indexedDB = createIndexedDB({ failWrites });
  const legacyValue = JSON.stringify(legacyExpenses);
  const localStorage = createLocalStorage({
    'axon_expenses_v1:main': legacyValue,
    ...(dirty ? { 'axon_project_dirty_v1::main': '1' } : {})
  });
  const context = {
    window: { indexedDB: indexedDB.indexedDB },
    localStorage,
    console,
    structuredClone,
    expenses: [],
    categories: [],
    buildArea: 2000,
    receipts: [],
    allocations: [],
    tasks: [],
    workbookPages: [],
    activePageId: null,
    activeProjectName: 'Prem residence',
    localDatabasePromise: null,
    localRecoveryRequired: false,
    lastLocalStorageError: null,
    pendingProjectIds: new Set(),
    projectSaveVersions: new Map(),
    $: () => null,
    uid: () => 'generated-id',
    setSyncStatus() {},
    mockTransactions: [],
    defaultCategories: [],
    mockTasks: [],
    mockPages: [],
    indexedDBHarness: indexedDB
  };
  vm.createContext(context);
  vm.runInContext(`
    const LOCAL_DB_NAME = 'axon-tracker-local';
    const LOCAL_DB_VERSION = 1;
    const LOCAL_STATE_STORE = 'project_state';
    const LOCAL_META_STORE = 'metadata';
    const LS_KEY = 'axon_expenses_v1';
    const LS_CAT = 'axon_categories_v1';
    const LS_AREA = 'axon_build_area_v1';
    const LS_RECEIPTS = 'axon_receipts_v1';
    const LS_ALLOCS = 'axon_allocs_v1';
    const LS_TASKS = 'axon_tasks_v1';
    const LS_WORKBOOK = 'axon_workbook_v1';
    const LS_DASHBOARD_PREFS = 'axon_dashboard_prefs_v1';
    const LS_DIRTY = 'axon_project_dirty_v1';
    const LEGACY_PROJECT_ID = 'main';
    const projectStorageKey = (key, projectId) => key + '::' + projectId;
    ${persistenceCode}
  `, context);
  return { context, indexedDB, localStorage, legacyValue };
}

test('migrates oversized legacy project data to IndexedDB without changing the source key', async () => {
  const image = `data:image/jpeg;base64,${'A'.repeat(5 * 1024 * 1024)}`;
  const expenses = [{ id: 'existing-expense', description: 'Existing receipt', image }];
  const { context, indexedDB, localStorage, legacyValue } = createContext({ legacyExpenses: expenses, dirty: true });

  const loaded = await vm.runInContext('loadState("main")', context);

  assert.equal(loaded, true);
  assert.equal(localStorage.getItem('axon_expenses_v1:main'), legacyValue);
  const cached = indexedDB.getRecord('project_state', 'main');
  assert.equal(cached.payload.expenses[0].image, image);
  assert.equal(cached.pending, true);
});

test('reopening a migrated project is idempotent and uses the IndexedDB copy', async () => {
  const { context, indexedDB } = createContext({
    legacyExpenses: [{ id: 'existing-expense', description: 'Original' }]
  });

  assert.equal(await vm.runInContext('loadState("main")', context), true);
  const initialWrites = indexedDB.writeCount;
  context.localStorage.setItem('axon_expenses_v1:main', JSON.stringify([{ id: 'different', description: 'Later value' }]));

  assert.equal(await vm.runInContext('loadState("main")', context), true);
  assert.equal(context.expenses[0].id, 'existing-expense');
  assert.equal(indexedDB.writeCount, initialWrites);
});

test('a failed IndexedDB migration leaves the complete legacy value untouched', async () => {
  const image = `data:image/jpeg;base64,${'B'.repeat(1024 * 1024)}`;
  const expenses = [{ id: 'existing-expense', image }];
  const { context, indexedDB, localStorage, legacyValue } = createContext({ legacyExpenses: expenses, failWrites: true });

  const loaded = await vm.runInContext('loadState("main")', context);

  assert.equal(loaded, false);
  assert.equal(localStorage.getItem('axon_expenses_v1:main'), legacyValue);
  assert.equal(indexedDB.getRecord('project_state', 'main'), null);
  assert.equal(context.localRecoveryRequired, true);
  assert.match(context.lastLocalStorageError.message, /quota failure/);
});

test('retrying a quota-failed migration saves the complete legacy value to IndexedDB', async () => {
  const image = `data:image/jpeg;base64,${'C'.repeat(1024 * 1024)}`;
  const expenses = [{ id: 'existing-expense', description: 'Existing receipt', image }];
  const { context, indexedDB, localStorage, legacyValue } = createContext({ legacyExpenses: expenses, failWrites: true });

  assert.equal(await vm.runInContext('loadState("main")', context), false);
  assert.equal(localStorage.getItem('axon_expenses_v1:main'), legacyValue);

  indexedDB.setFailWrites(false);
  assert.equal(await vm.runInContext('loadState("main")', context), true);
  assert.equal(localStorage.getItem('axon_expenses_v1:main'), legacyValue);
  assert.equal(indexedDB.getRecord('project_state', 'main').payload.expenses[0].image, image);
  assert.equal(context.localRecoveryRequired, false);
});

test('a failed legacy migration defers cloud loading until its local data is cached', async () => {
  const { context } = createContext({ legacyExpenses: [{ id: 'existing-expense', description: 'Legacy value' }], failWrites: true });

  assert.equal(await vm.runInContext('loadState("main")', context), false);
  assert.equal(vm.runInContext('shouldDeferCloudLoad("main")', context), true);

  context.pendingProjectIds.add('main');
  assert.equal(vm.runInContext('shouldDeferCloudLoad("main")', context), false);
});

test('a quota-failed update keeps the prior cache and pending edits until a full retry succeeds', async () => {
  const original = [{ id: 'existing-expense', description: 'Original' }];
  const updated = [{ id: 'existing-expense', description: 'Updated', image: `data:image/jpeg;base64,${'D'.repeat(1024 * 1024)}` }];
  const { context, indexedDB } = createContext({ legacyExpenses: original });

  assert.equal(await vm.runInContext('loadState("main")', context), true);
  const originalRecord = structuredClone(indexedDB.getRecord('project_state', 'main'));

  indexedDB.setFailWrites(true);
  context.expenses = updated;
  vm.runInContext(`
    markPendingChanges('main');
    localRecoveryRequired = true;
    lastLocalStorageError = new Error('QuotaExceededError');
  `, context);

  await assert.rejects(vm.runInContext('saveLocalState("main")', context), /quota failure/);
  assert.deepEqual(indexedDB.getRecord('project_state', 'main'), originalRecord);
  assert.equal(vm.runInContext('hasUnrecoverablePendingChanges("main")', context), true);
  assert.equal(context.expenses[0].description, 'Updated');

  indexedDB.setFailWrites(false);
  await vm.runInContext('saveLocalState("main")', context);
  assert.equal(indexedDB.getRecord('project_state', 'main').payload.expenses[0].description, 'Updated');
  assert.equal(indexedDB.getRecord('project_state', 'main').pending, true);
  assert.equal(context.localRecoveryRequired, false);
  assert.equal(vm.runInContext('hasUnrecoverablePendingChanges("main")', context), false);
});

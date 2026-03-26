const DB_NAME = 'dfw-app'
const DB_VERSION = 2
const STORE_NAME = 'imported-sources'
const MEDIA_STORE_NAME = 'place-media'

function openDatabase() {
  if (!globalThis.indexedDB) return Promise.resolve(null)

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
    const db = request.result
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      db.createObjectStore(STORE_NAME, { keyPath: 'id' })
    }
    if (!db.objectStoreNames.contains(MEDIA_STORE_NAME)) {
      db.createObjectStore(MEDIA_STORE_NAME, { keyPath: 'id' })
    }
  }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore(mode, callback) {
  const db = await openDatabase()
  if (!db) return null

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode)
    const store = tx.objectStore(STORE_NAME)
    const result = callback(store)

    tx.oncomplete = () => resolve(result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export async function loadImportedSources() {
  const db = await openDatabase()
  if (!db) return {}

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.getAll()

    request.onsuccess = () => {
      const entries = request.result || []
      resolve(
        entries.reduce((accumulator, entry) => {
          if (entry?.id) {
            accumulator[entry.id] = {
              sourceText: entry.sourceText ?? '',
              sourceBytes: entry.sourceBytes ?? null,
              sourceFormat: entry.sourceFormat ?? '',
              sourceMime: entry.sourceMime ?? '',
              sourceName: entry.sourceName ?? '',
              displayName: entry.displayName ?? entry.sourceName ?? '',
              folderId: entry.folderId ?? 'inbox',
              routeColor: entry.routeColor ?? '#4f8cff',
              planMilesPerDay: entry.planMilesPerDay ?? null,
              planReverseDirection: Boolean(entry.planReverseDirection),
              planDayBreakpoints: Array.isArray(entry.planDayBreakpoints) ? entry.planDayBreakpoints : [],
              updatedAt: entry.updatedAt ?? null,
            }
          }
          return accumulator
        }, {}),
      )
    }

    request.onerror = () => reject(request.error)
    tx.onerror = () => reject(tx.error)
  })
}

export async function saveImportedSource(id, source) {
  if (!id || (!source?.sourceText && !source?.sourceBytes)) return

  await withStore('readwrite', (store) =>
    store.put({
      id,
      sourceText: source.sourceText ?? '',
      sourceBytes: source.sourceBytes ?? null,
      sourceFormat: source.sourceFormat ?? '',
      sourceMime: source.sourceMime ?? '',
      sourceName: source.sourceName ?? '',
      displayName: source.displayName ?? source.sourceName ?? '',
      folderId: source.folderId ?? 'inbox',
      routeColor: source.routeColor ?? '#4f8cff',
      planMilesPerDay: source.planMilesPerDay ?? null,
      planReverseDirection: Boolean(source.planReverseDirection),
      planDayBreakpoints: Array.isArray(source.planDayBreakpoints) ? source.planDayBreakpoints : [],
      updatedAt: new Date().toISOString(),
    }),
  )
}

export async function deleteImportedSource(id) {
  if (!id) return

  await withStore('readwrite', (store) => store.delete(id))
}

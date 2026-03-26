const DB_NAME = 'dfw-app'
const DB_VERSION = 2
const MEDIA_STORE_NAME = 'place-media'
const IMPORTED_STORE_NAME = 'imported-sources'

function openDatabase() {
  if (!globalThis.indexedDB) return Promise.resolve(null)

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(IMPORTED_STORE_NAME)) {
        db.createObjectStore(IMPORTED_STORE_NAME, { keyPath: 'id' })
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
    const tx = db.transaction(MEDIA_STORE_NAME, mode)
    const store = tx.objectStore(MEDIA_STORE_NAME)
    const result = callback(store)

    tx.oncomplete = () => resolve(result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export async function loadAllPlaceMedia() {
  const db = await openDatabase()
  if (!db) return []

  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEDIA_STORE_NAME, 'readonly')
    const store = tx.objectStore(MEDIA_STORE_NAME)
    const request = store.getAll()

    request.onsuccess = () => {
      resolve(request.result || [])
    }

    request.onerror = () => reject(request.error)
    tx.onerror = () => reject(tx.error)
  })
}

export async function savePlaceMedia(media) {
  if (!media?.id || !media?.placeId || !media?.blob) return

  await withStore('readwrite', (store) =>
    store.put({
      id: media.id,
      placeId: media.placeId,
      kind: media.kind || 'image',
      name: media.name || '',
      mimeType: media.mimeType || '',
      blob: media.blob,
      createdAt: media.createdAt || new Date().toISOString(),
    }),
  )
}

export async function deletePlaceMedia(id) {
  if (!id) return

  await withStore('readwrite', (store) => store.delete(id))
}

export async function deletePlaceMediaForPlace(placeId) {
  if (!placeId) return

  const items = await loadAllPlaceMedia()
  const matches = items.filter((item) => item.placeId === placeId)
  await Promise.all(matches.map((item) => deletePlaceMedia(item.id)))
}

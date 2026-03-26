import { DOMParser as LinkedomParser } from 'linkedom'
import { Decoder, Stream } from '@garmin/fitsdk'

const XmlParser = globalThis.DOMParser ?? LinkedomParser

function textValue(parent, selector) {
  return parent?.querySelector(selector)?.textContent?.trim() ?? ''
}

function numberValue(parent, selector) {
  const value = Number.parseFloat(textValue(parent, selector))
  return Number.isFinite(value) ? value : null
}

function toRadians(value) {
  return (value * Math.PI) / 180
}

function haversineDistanceMeters(a, b) {
  const earthRadiusMeters = 6371000
  const latDelta = toRadians(b.lat - a.lat)
  const lngDelta = toRadians(b.lng - a.lng)
  const lat1 = toRadians(a.lat)
  const lat2 = toRadians(b.lat)

  const sinLat = Math.sin(latDelta / 2)
  const sinLng = Math.sin(lngDelta / 2)
  const haversine = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng
  const arc = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))

  return earthRadiusMeters * arc
}

function deriveDistanceMeters(trackpoints) {
  if (trackpoints.length < 2) return null

  let totalMeters = 0
  for (let index = 1; index < trackpoints.length; index += 1) {
    totalMeters += haversineDistanceMeters(trackpoints[index - 1], trackpoints[index])
  }

  return totalMeters > 0 ? totalMeters : null
}

function deriveDurationSeconds(trackpoints) {
  const timestamps = trackpoints
    .map((point) => point.time)
    .filter(Boolean)
    .map((value) => Date.parse(value))
    .filter(Number.isFinite)

  if (timestamps.length < 2) return null

  const durationSeconds = (timestamps[timestamps.length - 1] - timestamps[0]) / 1000
  return durationSeconds > 0 ? durationSeconds : null
}

function formatDistance(meters) {
  if (!Number.isFinite(meters) || meters <= 0) return 'Unknown distance'
  const miles = meters / 1609.344
  return `${miles.toFixed(1)} mi`
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Unknown duration'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes} min`
}

function titleCase(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function lowerCompact(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
}

function labelForActivityType(...values) {
  const activityType = normalizeActivityType(...values)
  const labels = {
    run: 'Run',
    hike: 'Hike',
    walk: 'Walk',
    ski: 'Ski',
    bike: 'Bike',
    swim: 'Swim',
    workout: 'Workout',
    offroad: 'Offroad',
    archery: 'Archery',
    other: 'Other',
  }

  return labels[activityType] || 'Run'
}

function normalizeActivityType(...values) {
  const text = values.map(lowerCompact).filter(Boolean).join(' ')
  if (!text) return 'run'
  if (text.includes('archery') || text.includes('bow') || text.includes('arrow') || text.includes('target')) return 'archery'
  if (text.includes('offroad') || text.includes('off road') || text.includes('4x4') || text.includes('overland') || text.includes('jeep') || text.includes('mud') || text.includes('trail ride') || text.includes('dirt road')) return 'offroad'
  if (text.includes('alpine ski') || text.includes('downhill ski') || text.includes('skiing') || text.includes('cross country ski') || text.includes('xc ski')) return 'ski'
  if (text.includes('cycling') || text.includes('bike') || text.includes('biking') || text.includes('ride') || text.includes('mtb') || text.includes('e-bike') || text.includes('gravel') || text.includes('commute')) return 'bike'
  if (text.includes('swimming') || text.includes('swim')) return 'swim'
  if (text.includes('walking') || text.includes('walk')) return 'walk'
  if (text.includes('run') || text.includes('jog')) return 'run'
  if (text.includes('hiking') || text.includes('hike') || text.includes('trail run') || text.includes('trail running') || text.includes('backcountry') || text.includes('mountain')) return 'hike'
  if (text.includes('ski')) return 'ski'
  if (text.includes('workout') || text.includes('training') || text.includes('exercise')) return 'workout'
  return 'other'
}

function average(values) {
  const numericValues = values.filter(Number.isFinite)
  if (!numericValues.length) return null
  return numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length
}

function maxValue(values) {
  const numericValues = values.filter(Number.isFinite)
  if (!numericValues.length) return null
  return Math.max(...numericValues)
}

function minValue(values) {
  const numericValues = values.filter(Number.isFinite)
  if (!numericValues.length) return null
  return Math.min(...numericValues)
}

function formatMetersToFeet(meters) {
  if (!Number.isFinite(meters)) return null
  return meters * 3.28084
}

function formatSpeedMph(metersPerSecond) {
  if (!Number.isFinite(metersPerSecond)) return null
  return metersPerSecond * 2.2369362920544
}

function summarizeElevation(route) {
  const elevations = route.map((point) => (Number.isFinite(point[2]) ? point[2] : null)).filter(Number.isFinite)
  if (!elevations.length) return { min: null, max: null, gain: null, loss: null }

  let gain = 0
  let loss = 0
  for (let index = 1; index < elevations.length; index += 1) {
    const delta = elevations[index] - elevations[index - 1]
    if (delta > 0) gain += delta
    else if (delta < 0) loss += Math.abs(delta)
  }

  return {
    min: minValue(elevations),
    max: maxValue(elevations),
    gain: gain > 0 ? gain : null,
    loss: loss > 0 ? loss : null,
  }
}

function summarizeGarminMetrics(recordMesgs, session, lap, route, fileId, fallbackName) {
  const heartRates = recordMesgs.map((record) => record.heartRate)
  const cadences = recordMesgs.map((record) => record.cadence)
  const powers = recordMesgs.map((record) => record.power)
  const temperatures = recordMesgs.map((record) => record.temperature)
  const speeds = recordMesgs.map((record) => record.enhancedSpeed ?? record.speed)
  const altitudes = route.map((point) => point[2])
  const elevation = summarizeElevation(route)
  const sessionElevationGain = Number.isFinite(session?.totalAscent) ? session.totalAscent : Number.isFinite(lap?.totalAscent) ? lap.totalAscent : null
  const sessionElevationLoss = Number.isFinite(session?.totalDescent) ? session.totalDescent : Number.isFinite(lap?.totalDescent) ? lap.totalDescent : null

  return {
    activityType: normalizeActivityType(session?.subSport, session?.sport, lap?.sport, fileId?.type, fallbackName),
    activityLabel: labelForActivityType(session?.subSport, session?.sport, lap?.sport, fileId?.type, fallbackName),
    heartRate: {
      avg: Number.isFinite(session?.avgHeartRate) ? session.avgHeartRate : Number.isFinite(lap?.avgHeartRate) ? lap.avgHeartRate : average(heartRates),
      max: Number.isFinite(session?.maxHeartRate) ? session.maxHeartRate : Number.isFinite(lap?.maxHeartRate) ? lap.maxHeartRate : maxValue(heartRates),
    },
    cadence: {
      avg: Number.isFinite(session?.avgCadence) ? session.avgCadence : Number.isFinite(lap?.avgCadence) ? lap.avgCadence : average(cadences),
      max: Number.isFinite(session?.maxCadence) ? session.maxCadence : Number.isFinite(lap?.maxCadence) ? lap.maxCadence : maxValue(cadences),
    },
    power: {
      avg: average(powers),
      max: maxValue(powers),
    },
    temperature: {
      avg: average(temperatures),
      max: maxValue(temperatures),
      min: minValue(temperatures),
    },
    speed: {
      avg: formatSpeedMph(Number.isFinite(session?.avgSpeed) ? session.avgSpeed : Number.isFinite(lap?.avgSpeed) ? lap.avgSpeed : average(speeds)),
      max: formatSpeedMph(Number.isFinite(session?.maxSpeed) ? session.maxSpeed : Number.isFinite(lap?.maxSpeed) ? lap.maxSpeed : maxValue(speeds)),
    },
    altitude: {
      min: formatMetersToFeet(minValue(altitudes)),
      max: formatMetersToFeet(maxValue(altitudes)),
      gain: formatMetersToFeet(sessionElevationGain ?? elevation.gain),
      loss: formatMetersToFeet(sessionElevationLoss ?? elevation.loss),
    },
    samples: {
      records: recordMesgs.length,
      laps: lap ? 1 : 0,
    },
  }
}

function maybeDate(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.valueOf()) ? null : date
  }
  return null
}

function lastValue(values) {
  if (!Array.isArray(values) || !values.length) return null
  return values[values.length - 1] ?? null
}

function semicirclesToDegrees(value) {
  if (!Number.isFinite(value)) return null
  return (value * 180) / 2147483648
}

function decodeFitTimestamp(value) {
  const date = maybeDate(value)
  return date ? date.toISOString() : null
}

function extractFitRoute(recordMesgs) {
  if (!Array.isArray(recordMesgs)) return []

  return recordMesgs
    .map((record) => {
      const lng = semicirclesToDegrees(record.positionLong)
      const lat = semicirclesToDegrees(record.positionLat)
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null

      const elevation = Number.isFinite(record.altitude) ? record.altitude : null
      return Number.isFinite(elevation) ? [lng, lat, elevation] : [lng, lat]
    })
    .filter(Boolean)
}

function deriveFitDistanceMeters(route) {
  if (!Array.isArray(route) || route.length < 2) return null

  let totalMeters = 0
  for (let index = 1; index < route.length; index += 1) {
    totalMeters += haversineDistanceMeters(
      { lng: route[index - 1][0], lat: route[index - 1][1] },
      { lng: route[index][0], lat: route[index][1] },
    )
  }

  return totalMeters > 0 ? totalMeters : null
}

function collectFitMessage(messages, key) {
  return Array.isArray(messages?.[key]) ? messages[key] : []
}

function buildFitRunFromMessages(messages, fallbackName) {
  const recordMesgs = collectFitMessage(messages, 'recordMesgs')
  const session = lastValue(collectFitMessage(messages, 'sessionMesgs'))
  const lap = lastValue(collectFitMessage(messages, 'lapMesgs'))
  const activity = lastValue(collectFitMessage(messages, 'activityMesgs'))
  const fileId = lastValue(collectFitMessage(messages, 'fileIdMesgs'))
  const route = extractFitRoute(recordMesgs)
  const garminMetrics = summarizeGarminMetrics(recordMesgs, session, lap, route, fileId, fallbackName)

  const name =
    (typeof session?.subSport === 'string' && session.subSport !== 'generic' && titleCase(session.subSport)) ||
    (typeof session?.sport === 'string' && titleCase(session.sport)) ||
    (typeof activity?.type === 'string' && titleCase(activity.type)) ||
    (typeof fileId?.type === 'string' && titleCase(fileId.type)) ||
    fallbackName.replace(/\.[^.]+$/, '')
  const activityType = garminMetrics.activityType
  const activityLabel = garminMetrics.activityLabel

  const startDate = maybeDate(session?.startTime) || maybeDate(activity?.timestamp) || maybeDate(lap?.startTime) || maybeDate(recordMesgs[0]?.timestamp)
  const distanceMeters = Number.isFinite(session?.totalDistance)
    ? session.totalDistance
    : Number.isFinite(lap?.totalDistance)
      ? lap.totalDistance
      : deriveFitDistanceMeters(route)
  const durationSeconds = Number.isFinite(session?.totalTimerTime)
    ? session.totalTimerTime
    : Number.isFinite(lap?.totalTimerTime)
      ? lap.totalTimerTime
      : Number.isFinite(activity?.totalTimerTime)
        ? activity.totalTimerTime
        : null
  const noteParts = []

  if (typeof session?.sport === 'string') noteParts.push(titleCase(session.sport))
  if (typeof session?.subSport === 'string' && session.subSport !== 'generic') noteParts.push(titleCase(session.subSport))
  if (typeof fileId?.type === 'string' && fileId.type !== 'activity') noteParts.push(titleCase(fileId.type))

  const center = midpoint(route)
  const fallbackLng = semicirclesToDegrees(session?.startPositionLong ?? lap?.startPositionLong)
  const fallbackLat = semicirclesToDegrees(session?.startPositionLat ?? lap?.startPositionLat)
  const location = Number.isFinite(fallbackLng) && Number.isFinite(fallbackLat) ? { lng: fallbackLng, lat: fallbackLat } : center

  return {
    id: crypto.randomUUID(),
    kind: 'run',
    name,
    phase: 'past',
    lng: location.lng,
    lat: location.lat,
    summary: startDate ? `Imported FIT activity from ${startDate.toLocaleString()}.` : `Imported FIT activity from ${fallbackName}.`,
    status: `${activityLabel} imported`,
    activityType,
    activityLabel,
    distance: formatDistance(Number.isFinite(distanceMeters) ? distanceMeters : deriveFitDistanceMeters(route)),
    duration: formatDuration(Number.isFinite(durationSeconds) ? durationSeconds : null),
    note: noteParts.length ? noteParts.join(' | ') : `Imported from ${fallbackName}.`,
    route,
    importedFrom: fallbackName,
    recordedAt: decodeFitTimestamp(startDate),
    garminMetrics,
  }
}

async function parseFitFile(file) {
  const arrayBuffer = await file.arrayBuffer()
  const decoder = new Decoder(Stream.fromArrayBuffer(arrayBuffer))

  if (!decoder.isFIT()) {
    throw new Error('Could not read that file. Check that it is a valid FIT file.')
  }

  if (!decoder.checkIntegrity()) {
    throw new Error('Could not read that file. Check that it is a valid FIT file.')
  }

  const { messages, errors } = new Decoder(Stream.fromArrayBuffer(arrayBuffer)).read({
    applyScaleAndOffset: true,
    expandComponents: true,
    expandSubFields: true,
    convertTypesToStrings: true,
    convertDateTimesToDates: true,
    mergeHeartRates: true,
    includeUnknownData: false,
    skipHeader: false,
    dataOnly: false,
  })

  if (errors.length) {
    throw errors[0] instanceof Error ? errors[0] : new Error('Could not read that FIT file.')
  }

  const run = buildFitRunFromMessages(messages, file.name)
  return {
    ...run,
    sourceBytes: arrayBuffer,
    sourceFormat: 'fit',
    sourceMime: file.type || 'application/octet-stream',
  }
}

function midpoint(route) {
  if (!route.length) return { lng: -73.98, lat: 40.76 }
  const middle = route[Math.floor(route.length / 2)]
  return { lng: middle[0], lat: middle[1] }
}

function routeToTrackpoints(route) {
  return route.map(([lng, lat, ele]) => ({
    lng,
    lat,
    ele: Number.isFinite(ele) ? ele : null,
  }))
}

function collectLineCoordinates(coordinates, route = []) {
  if (!Array.isArray(coordinates)) return route

  if (coordinates.length && typeof coordinates[0] === 'number') {
    const [lng, lat, ele] = coordinates
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      route.push(Number.isFinite(ele) ? [lng, lat, ele] : [lng, lat])
    }
    return route
  }

  coordinates.forEach((item) => {
    collectLineCoordinates(item, route)
  })

  return route
}

function extractGeoJsonRoute(geometry) {
  if (!geometry) return []

  if (geometry.type === 'LineString') {
    return collectLineCoordinates(geometry.coordinates)
  }

  if (geometry.type === 'MultiLineString') {
    return collectLineCoordinates(geometry.coordinates)
  }

  if (geometry.type === 'GeometryCollection') {
    return (geometry.geometries || []).flatMap((item) => extractGeoJsonRoute(item))
  }

  return []
}

function parseGeoJson(json, fallbackName) {
  const features = json?.type === 'FeatureCollection'
    ? (Array.isArray(json.features) ? json.features : [])
    : json?.type === 'Feature'
      ? [json]
      : []

  const lineFeatures = features
    .map((feature) => ({
      feature,
      route: extractGeoJsonRoute(feature?.geometry),
    }))
    .filter(({ route }) => route.length)

  if (!lineFeatures.length) {
    throw new Error('No route points found in that file.')
  }

  const route = lineFeatures.flatMap(({ route }) => route)
  const sourceFeature = lineFeatures[0].feature
  const properties = sourceFeature?.properties || {}
  const name = properties.name || properties.title || fallbackName.replace(/\.[^.]+$/, '')
  const activityType = normalizeActivityType(properties.activityType, properties.activity, properties.sport, properties.subSport, name, fallbackName)
  const recordedAt = properties.time || properties.recordedAt || properties.startTime || properties.datetime || null
  const note = properties.description || properties.summary || properties.notes || `Imported from ${fallbackName}.`
  const durationSeconds = typeof properties.duration === 'number' ? properties.duration : Number.parseFloat(properties.duration)
  const distanceMeters = typeof properties.distance === 'number' ? properties.distance : Number.parseFloat(properties.distance)
  const center = midpoint(route)

  return {
    id: crypto.randomUUID(),
    kind: 'run',
    name,
    phase: 'past',
    lng: center.lng,
    lat: center.lat,
    summary: recordedAt ? `Imported ${labelForActivityType(activityType).toLowerCase()} from ${new Date(recordedAt).toLocaleString()}.` : `Imported ${labelForActivityType(activityType).toLowerCase()} from ${fallbackName}.`,
    status: `${labelForActivityType(activityType)} imported`,
    activityType,
    activityLabel: labelForActivityType(activityType),
    distance: formatDistance(Number.isFinite(distanceMeters) ? distanceMeters : deriveDistanceMeters(routeToTrackpoints(route))),
    duration: formatDuration(Number.isFinite(durationSeconds) ? durationSeconds : null),
    note,
    route,
    importedFrom: fallbackName,
    recordedAt,
  }
}

function parseGpx(xml, fallbackName) {
  const name = textValue(xml, 'metadata > name') || textValue(xml, 'trk > name') || fallbackName
  const normalizedActivityType = normalizeActivityType(name, textValue(xml, 'metadata > desc'), fallbackName)
  const activityType = normalizedActivityType === 'other' ? 'run' : normalizedActivityType
  const trackpoints = [...xml.querySelectorAll('trkpt')]
    .map((point) => ({
      lng: Number.parseFloat(point.getAttribute('lon')),
      lat: Number.parseFloat(point.getAttribute('lat')),
      ele: numberValue(point, 'ele'),
      time: textValue(point, 'time') || null,
    }))
    .filter(({ lng, lat }) => Number.isFinite(lng) && Number.isFinite(lat))

  const route = trackpoints.map((point) => (Number.isFinite(point.ele) ? [point.lng, point.lat, point.ele] : [point.lng, point.lat]))
  const metadataTime = textValue(xml, 'metadata > time') || trackpoints[0]?.time || null
  const distanceMeters = numberValue(xml, 'extensions distance') ?? deriveDistanceMeters(trackpoints)
  const durationSeconds = numberValue(xml, 'extensions duration') ?? deriveDurationSeconds(trackpoints)
  const note = textValue(xml, 'metadata > desc') || `Imported from ${fallbackName}.`
  const center = midpoint(route)

  return {
    id: crypto.randomUUID(),
    kind: 'run',
    name,
    phase: 'past',
    lng: center.lng,
    lat: center.lat,
    summary: metadataTime ? `Imported ${labelForActivityType(activityType).toLowerCase()} from ${new Date(metadataTime).toLocaleString()}.` : `Imported ${labelForActivityType(activityType).toLowerCase()} from ${fallbackName}.`,
    status: `${labelForActivityType(activityType)} imported`,
    activityType,
    activityLabel: labelForActivityType(activityType),
    distance: formatDistance(distanceMeters),
    duration: formatDuration(durationSeconds),
    note,
    route,
    importedFrom: fallbackName,
    recordedAt: metadataTime,
  }
}

function parseTcx(xml, fallbackName) {
  const activity = xml.querySelector('Activity')
  const lap = xml.querySelector('Lap')
  const name = textValue(activity, 'Notes') || fallbackName.replace(/\.[^.]+$/, '')
  const activityType = normalizeActivityType(activity?.getAttribute('Sport'), name, fallbackName)
  const trackpoints = [...xml.querySelectorAll('Trackpoint')]
    .map((point) => ({
      lng: numberValue(point, 'LongitudeDegrees'),
      lat: numberValue(point, 'LatitudeDegrees'),
      ele: numberValue(point, 'AltitudeMeters'),
      time: textValue(point, 'Time') || null,
    }))
    .filter(({ lng, lat }) => Number.isFinite(lng) && Number.isFinite(lat))

  const route = trackpoints.map((point) => (Number.isFinite(point.ele) ? [point.lng, point.lat, point.ele] : [point.lng, point.lat]))
  const startTime = lap?.getAttribute('StartTime') || textValue(activity, 'Id') || trackpoints[0]?.time || null
  const distanceMeters = numberValue(lap, 'DistanceMeters') ?? deriveDistanceMeters(trackpoints)
  const durationSeconds = numberValue(lap, 'TotalTimeSeconds') ?? deriveDurationSeconds(trackpoints)
  const note = `Imported from ${fallbackName}.`
  const center = midpoint(route)

  return {
    id: crypto.randomUUID(),
    kind: 'run',
    name,
    phase: 'past',
    lng: center.lng,
    lat: center.lat,
    summary: startTime ? `Imported ${labelForActivityType(activityType).toLowerCase()} from ${new Date(startTime).toLocaleString()}.` : `Imported ${labelForActivityType(activityType).toLowerCase()} from ${fallbackName}.`,
    status: `${labelForActivityType(activityType)} imported`,
    activityType,
    activityLabel: labelForActivityType(activityType),
    distance: formatDistance(distanceMeters),
    duration: formatDuration(durationSeconds),
    note,
    route,
    importedFrom: fallbackName,
    recordedAt: startTime,
  }
}

export async function importRunFile(file) {
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (!extension) throw new Error('Unknown file type.')
  if (!['fit', 'gpx', 'tcx', 'geojson', 'json'].includes(extension)) throw new Error('Unsupported file. Use FIT, GPX, TCX, or GeoJSON.')

  if (extension === 'fit') {
    return parseFitFile(file)
  }

  const text = await file.text()
  let run

  if (extension === 'geojson' || extension === 'json') {
    try {
      run = parseGeoJson(JSON.parse(text), file.name)
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error('Could not read that file. Check that it is valid JSON.')
      }
      throw error
    }
  } else {
    const xml = new XmlParser().parseFromString(text, 'application/xml')
    if (xml.querySelector('parsererror')) throw new Error('Could not read that file. Check that it is valid XML.')
    run = extension === 'gpx' ? parseGpx(xml, file.name) : parseTcx(xml, file.name)
  }

  if (extension !== 'fit' && !run.route.length) throw new Error('No route points found in that file.')
  return {
    ...run,
    sourceText: text,
    sourceFormat: extension === 'json' ? 'geojson' : extension,
    sourceMime: file.type || (extension === 'gpx' ? 'application/gpx+xml' : 'application/geo+json'),
  }
}

export { buildFitRunFromMessages }

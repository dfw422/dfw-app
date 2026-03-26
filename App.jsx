import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpDown, Activity, Calendar, Camera, CarFront, Coffee, Compass, Download, FileText, Flag, Folder, FolderPlus, Maximize2, Minimize2, Mountain, NotebookPen, PenLine, Plus, Search, Settings2, Target, Trash2, Upload, Wrench } from 'lucide-react'
import html2canvas from 'html2canvas'
import LifeMap from './components/LifeMap'
import { importRunFile } from './lib/runImport'
import { deleteImportedSource, loadImportedSources, saveImportedSource } from './lib/importStore'
import { deletePlaceMedia, deletePlaceMediaForPlace, loadAllPlaceMedia, savePlaceMedia } from './lib/placeMediaStore'
import './App.css'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN
const STORAGE_KEY = 'dfw-app-map-state-v2'
const FILE_FOLDERS_KEY = 'dfw-app-file-folders-v1'
const UI_STATE_KEY = 'dfw-app-ui-state-v1'
const HUD_COLOR_KEY = 'dfw-app-hud-color-v1'
const HUD_OPACITY_KEY = 'dfw-app-hud-opacity-v1'
const DEFAULT_HUD_COLOR = '#5f6874'
const DEFAULT_HUD_OPACITY = 0.94
const HUD_COLOR_PRESETS = ['#5f6874', '#5b84c4', '#4f8c6e', '#b07a4b', '#8e6bb8', '#bf5f73']
const IMPORT_EXTENSIONS = ['fit', 'gpx', 'tcx', 'geojson', 'json']
const DEFAULT_ROUTE_COLOR = '#4f8cff'
const METERS_TO_FEET = 3.28084
const ACTIVITY_TYPES = [
  { id: 'run', label: 'Run' },
  { id: 'hike', label: 'Hike' },
  { id: 'walk', label: 'Walk' },
  { id: 'ski', label: 'Ski' },
  { id: 'bike', label: 'Bike' },
  { id: 'swim', label: 'Swim' },
  { id: 'workout', label: 'Workout' },
  { id: 'offroad', label: 'Offroad' },
  { id: 'archery', label: 'Archery' },
  { id: 'other', label: 'Other' },
]

const LOGBOOK_ACTIVITY_ORDER = ['run', 'bike', 'swim', 'ski', 'hike', 'walk', 'workout', 'offroad', 'archery', 'other', 'place']
const LOGBOOK_ACTIVITY_FILTERS = [
  { id: 'all', label: 'All' },
  ...ACTIVITY_TYPES,
  { id: 'place', label: 'Places' },
]

const DEFAULT_FILE_FOLDERS = [
  { id: 'inbox', name: 'Inbox', builtIn: true },
]

const DEMO_PLACE_IDS = new Set(['hudson', 'acadia', 'catskills', 'run-westside'])

const layers = [
  { id: 'past', label: 'Logbook', icon: Calendar, description: 'Activity archive and memory.' },
  { id: 'future', label: 'Future', icon: Flag, description: 'Bucket list and plans.' },
]

function mergePlaces(...groups) {
  const merged = new Map()

  groups.flat().filter(Boolean).forEach((place) => {
    if (!place?.id) return
    merged.set(place.id, { ...(merged.get(place.id) || {}), ...place, phase: normalizePlacePhase(place.phase || 'past') })
  })

  return [...merged.values()]
}

function loadPlaces() {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw)
    const cleaned = Array.isArray(parsed)
      ? parsed.filter((place) => place?.id && !DEMO_PLACE_IDS.has(place.id) && place.source !== 'seed')
      : []
    return cleaned.length ? mergePlaces(cleaned) : []
  } catch {
    return []
  }
}

function loadFileFolders() {
  try {
    const raw = localStorage.getItem(FILE_FOLDERS_KEY)
    if (!raw) return DEFAULT_FILE_FOLDERS

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.length) return DEFAULT_FILE_FOLDERS

    const cleaned = parsed
      .filter((folder) => folder?.id && folder?.name)
      .map((folder) => ({
        id: folder.id,
        name: folder.name,
        builtIn: Boolean(folder.builtIn),
      }))

    return cleaned.length ? cleaned : DEFAULT_FILE_FOLDERS
  } catch {
    return DEFAULT_FILE_FOLDERS
  }
}

function loadUiState() {
  const defaults = {
    activeLayer: 'past',
    selectedId: null,
    logbookView: 'chronological',
    logbookChronologicalYear: null,
    logbookChronologicalMonth: null,
    logbookActivityFilter: 'all',
    fileBrowserFolderId: 'all',
    fileBrowserSort: 'updated',
    fileBrowserSearch: '',
    planningMarkersVisible: true,
  }

  try {
    const raw = localStorage.getItem(UI_STATE_KEY)
    if (!raw) return defaults

    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return defaults

    return {
      activeLayer: parsed.activeLayer === 'future' ? 'future' : 'past',
      selectedId: typeof parsed.selectedId === 'string' && parsed.selectedId.trim() ? parsed.selectedId : null,
      logbookView: parsed.logbookView === 'activity' ? 'activity' : 'chronological',
      logbookChronologicalYear: Number.isFinite(parsed.logbookChronologicalYear) ? parsed.logbookChronologicalYear : null,
      logbookChronologicalMonth: Number.isFinite(parsed.logbookChronologicalMonth) ? parsed.logbookChronologicalMonth : null,
      logbookActivityFilter: typeof parsed.logbookActivityFilter === 'string' && parsed.logbookActivityFilter ? parsed.logbookActivityFilter : 'all',
      fileBrowserFolderId: typeof parsed.fileBrowserFolderId === 'string' && parsed.fileBrowserFolderId ? parsed.fileBrowserFolderId : 'all',
      fileBrowserSort: typeof parsed.fileBrowserSort === 'string' && parsed.fileBrowserSort ? parsed.fileBrowserSort : 'updated',
      fileBrowserSearch: typeof parsed.fileBrowserSearch === 'string' ? parsed.fileBrowserSearch : '',
      planningMarkersVisible: typeof parsed.planningMarkersVisible === 'boolean' ? parsed.planningMarkersVisible : true,
    }
  } catch {
    return defaults
  }
}

function createFolderId(name) {
  return `folder-${String(name || 'folder').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'folder'}-${Date.now().toString(36)}`
}

function normalizePlacePhase(phase) {
  return phase === 'present' ? 'future' : phase
}

function formatFeet(meters) {
  if (!Number.isFinite(meters)) return 'n/a'
  return `${Math.round(meters * METERS_TO_FEET)} ft`
}

function formatFeetValue(feet) {
  if (!Number.isFinite(feet)) return 'n/a'
  return `${Math.round(feet)} ft`
}

function parseMilesValue(value) {
  if (Number.isFinite(value)) return value
  const parsed = Number.parseFloat(String(value || '').replace(/[^0-9.]+/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function formatPlanningDays(days) {
  if (!Number.isFinite(days) || days <= 0) return 'n/a'
  return `${days.toFixed(1)} days`
}

function buildPlanningDayMilesList(totalMiles, milesPerDay) {
  if (!Number.isFinite(totalMiles) || totalMiles <= 0) return []
  const pace = Number.isFinite(milesPerDay) && milesPerDay > 0 ? milesPerDay : totalMiles
  const breakpoints = []
  let covered = 0

  while (covered < totalMiles - 0.0001) {
    covered = Math.min(totalMiles, covered + pace)
    breakpoints.push(covered)
  }

  return breakpoints
}

function rebalancePlanningDayMiles(dayMiles, index, nextMiles, totalMiles) {
  if (!Array.isArray(dayMiles) || index < 0 || index >= dayMiles.length || !Number.isFinite(totalMiles) || totalMiles <= 0) {
    return Array.isArray(dayMiles) ? dayMiles.slice() : []
  }

  const next = dayMiles.slice()
  const previous = index > 0 ? next[index - 1] : 0
  const following = index < next.length - 1 ? next[index + 1] : totalMiles
  const minMiles = previous + 0.5
  const maxMiles = Math.max(minMiles, following - 0.5)
  next[index] = clamp(Number.isFinite(nextMiles) ? nextMiles : next[index], minMiles, maxMiles)
  if (index === next.length - 1) {
    next[index] = totalMiles
  }
  return next
}

function normalizePlanningDayBreakpoints(dayMiles, totalMiles) {
  const values = Array.isArray(dayMiles)
    ? dayMiles.map((value) => parseMilesValue(value)).filter((value) => Number.isFinite(value) && value > 0)
    : []

  if (!values.length || !Number.isFinite(totalMiles) || totalMiles <= 0) return []

  const lastValue = values[values.length - 1]
  const treatAsBreakpoints = lastValue >= totalMiles * 0.8

  if (treatAsBreakpoints) {
    return values.map((value, index) => {
      const previous = index > 0 ? values[index - 1] : 0
      return clamp(value, previous + 0.5, totalMiles)
    })
  }

  const breakpoints = []
  let covered = 0

  values.forEach((value) => {
    covered = Math.min(totalMiles, covered + value)
    breakpoints.push(covered)
  })

  if (breakpoints.length) {
    breakpoints[breakpoints.length - 1] = totalMiles
  }

  return breakpoints
}

function formatDifficultyLabel(score) {
  if (!Number.isFinite(score)) return 'n/a'
  if (score < 18) return 'Easy'
  if (score < 32) return 'Moderate'
  return 'Hard'
}

function routeDistanceMiles(route) {
  if (!isValidRoute(route)) return null

  let totalMeters = 0
  for (let index = 1; index < route.length; index += 1) {
    totalMeters += haversineMeters(
      { lng: route[index - 1][0], lat: route[index - 1][1] },
      { lng: route[index][0], lat: route[index][1] },
    )
  }

  return totalMeters > 0 ? totalMeters / 1609.344 : null
}

function buildRoutePlanningAnalysis(route, intervalMilesOrDays, reverseDirection = false, expectedTotalMiles = null) {
  const hasDayList = Array.isArray(intervalMilesOrDays)
  const intervalMiles = hasDayList ? null : intervalMilesOrDays
  const explicitDayBreakpoints = hasDayList ? normalizePlanningDayBreakpoints(intervalMilesOrDays, expectedTotalMiles ?? routeDistanceMiles(route) ?? 0) : []

  if (!isValidRoute(route) || (!hasDayList && (!Number.isFinite(intervalMiles) || intervalMiles <= 0)) || (hasDayList && !explicitDayBreakpoints.length)) {
    return { markers: [], days: [], totals: { distanceMiles: null }, routeSeries: [] }
  }

  const coordinates = Array.isArray(route)
    ? route
        .filter((coordinate) => Array.isArray(coordinate) && Number.isFinite(coordinate[0]) && Number.isFinite(coordinate[1]))
        .map((coordinate) => [coordinate[0], coordinate[1]])
    : []

  const orderedCoordinates = reverseDirection ? [...coordinates].reverse() : coordinates
  if (orderedCoordinates.length < 2) {
    return { markers: [], days: [], totals: { distanceMiles: null }, routeSeries: [] }
  }

  const routeMiles = routeDistanceMiles(route) ?? 0
  const totalMiles = Number.isFinite(expectedTotalMiles) && expectedTotalMiles > 0
    ? expectedTotalMiles
    : Number.isFinite(routeMiles) && routeMiles > 0
      ? routeMiles
      : 0
  const targetMiles = hasDayList ? null : Math.max(intervalMiles, 0.1)

  const routeSeries = []
  let cumulativeMiles = 0

  orderedCoordinates.forEach((coordinate, index) => {
    if (index > 0) {
      const previous = orderedCoordinates[index - 1]
      cumulativeMiles += haversineMeters({ lng: previous[0], lat: previous[1] }, { lng: coordinate[0], lat: coordinate[1] }) / 1609.344
    }

    routeSeries.push({
      lng: coordinate[0],
      lat: coordinate[1],
      miles: cumulativeMiles,
    })
  })

  const profileMiles = routeSeries[routeSeries.length - 1]?.miles ?? 0
  const scaleFactor = profileMiles > 0 && Number.isFinite(totalMiles) && totalMiles > 0 ? totalMiles / profileMiles : 1

  if (scaleFactor !== 1) {
    routeSeries.forEach((point) => {
      point.miles *= scaleFactor
    })
  }

  function pointAtMiles(series, miles) {
    if (!series.length) return null
    if (miles <= series[0].miles) return series[0]
    if (miles >= totalMiles) return series[series.length - 1]

    for (let index = 1; index < series.length; index += 1) {
      const previous = series[index - 1]
      const current = series[index]
      if (miles > current.miles) continue

      const span = current.miles - previous.miles
      if (!Number.isFinite(span) || span <= 0) return current

      const ratio = clamp((miles - previous.miles) / span, 0, 1)
      return {
        lng: lerp(previous.lng, current.lng, ratio),
        lat: lerp(previous.lat, current.lat, ratio),
        miles,
      }
    }

    return series[series.length - 1]
  }

  const days = []
  let startMiles = 0

  const dayPlanBreakpoints = hasDayList
    ? explicitDayBreakpoints.slice()
    : buildPlanningDayMilesList(totalMiles, targetMiles)

  dayPlanBreakpoints.forEach((endMiles, index) => {
    const clampedEndMiles = Math.min(Math.max(endMiles, startMiles + 0.5), totalMiles)
    const distanceMiles = clampedEndMiles - startMiles
    const difficultyScore = distanceMiles * 10
    const difficultyLabel = formatDifficultyLabel(difficultyScore)

    days.push({
      day: index + 1,
      miles: distanceMiles,
      difficultyScore,
      difficultyLabel,
      startMiles,
      endMiles: clampedEndMiles,
    })

    startMiles = clampedEndMiles
  })

  const markers = days
    .map((day) => {
      const point = pointAtMiles(routeSeries, day.endMiles)
      if (!point) return null

      return {
        lng: point.lng,
        lat: point.lat,
        miles: day.endMiles,
        day: day.day,
        difficultyScore: day.difficultyScore,
        difficultyLabel: day.difficultyLabel,
      }
    })
    .filter(Boolean)

  return {
    markers,
    days,
    totals: {
      distanceMiles: totalMiles,
    },
    routeSeries,
  }
}

function buildElevationProfileGraph(routeSeries, maxPoints = 80) {
  if (!Array.isArray(routeSeries) || routeSeries.length < 2) return null

  const finiteSeries = []
  let cumulativeMiles = 0

  routeSeries.forEach((point, index) => {
    const elevation = Number.isFinite(point?.elevation) ? point.elevation : null
    if (!Number.isFinite(elevation)) return

    if (index > 0) {
      const previous = routeSeries[index - 1]
      if (Number.isFinite(previous?.lng) && Number.isFinite(previous?.lat) && Number.isFinite(point?.lng) && Number.isFinite(point?.lat)) {
        cumulativeMiles += haversineMeters(
          { lng: previous.lng, lat: previous.lat },
          { lng: point.lng, lat: point.lat },
        ) / 1609.344
      }
    }

    finiteSeries.push({
      ...point,
      elevation,
      miles: Number.isFinite(point?.miles) ? point.miles : cumulativeMiles,
    })
  })
  if (finiteSeries.length < 2) return null

  const totalMiles = finiteSeries[finiteSeries.length - 1]?.miles ?? 0
  if (!Number.isFinite(totalMiles) || totalMiles <= 0) return null

  const targetPoints = Math.max(8, Math.min(maxPoints, finiteSeries.length))
  const sampledPoints = []

  for (let index = 0; index < targetPoints; index += 1) {
    const fraction = targetPoints === 1 ? 0 : index / (targetPoints - 1)
    const sampleIndex = Math.round((finiteSeries.length - 1) * fraction)
    sampledPoints.push(finiteSeries[sampleIndex])
  }

  const elevations = sampledPoints
    .map((point) => point.elevation)
    .filter((value) => Number.isFinite(value))
  if (!elevations.length) return null

  const minElevation = Math.min(...elevations)
  const maxElevation = Math.max(...elevations)
  const elevationSpan = Math.max(maxElevation - minElevation, 1)
  const width = 100
  const height = 60
  const leftPad = 10
  const rightPad = 96
  const topPad = 6
  const bottomPad = 50

  const points = sampledPoints.map((point) => {
    const x = leftPad + ((point.miles / totalMiles) * (rightPad - leftPad))
    const elevation = point.elevation
    const y = bottomPad - ((elevation - minElevation) / elevationSpan) * (bottomPad - topPad)
    return { x, y, miles: point.miles, elevation, rawElevation: point.elevation }
  })

  return {
    points,
    pointsString: points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' '),
    totalMiles,
    minElevation,
    maxElevation,
    width,
    height,
    leftPad,
    rightPad,
    topPad,
    bottomPad,
  }
}

async function querySpotElevationFeet(lng, lat, map) {
  const terrainElevationMeters = map && typeof map.queryTerrainElevation === 'function'
    ? map.queryTerrainElevation({ lng, lat }, { exaggerated: false })
    : null

  try {
    const url = `https://epqs.nationalmap.gov/v1/json?x=${lng}&y=${lat}&units=Feet&wkid=4326`
    const response = await fetch(url)
    if (response.ok) {
      const payload = await response.json()
      const value = payload?.value
      if (Number.isFinite(value)) return value
    }
  } catch {
    // Fall back to the terrain mesh if EPQS is unavailable.
  }

  return Number.isFinite(terrainElevationMeters) ? terrainElevationMeters * 3.28084 : null
}

function toRadians(value) {
  return (value * Math.PI) / 180
}

function haversineMeters(a, b) {
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

function lerp(a, b, t) {
  return a + (b - a) * t
}

function buildBezierCurveCoordinates(points, controls, samplesPerSegment = 14) {
  if (!Array.isArray(points) || points.length < 2) return []
  if (points.length === 2) return points.map((point) => [point.lng, point.lat])

  const coordinates = []

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]
    const end = points[index + 1]
    const control = controls?.[index] ?? {
      lng: (start.lng + end.lng) / 2,
      lat: (start.lat + end.lat) / 2,
    }

    for (let step = 0; step <= samplesPerSegment; step += 1) {
      if (index > 0 && step === 0) continue
      const t = step / samplesPerSegment
      const abLng = lerp(start.lng, control.lng, t)
      const bcLng = lerp(control.lng, end.lng, t)
      const abLat = lerp(start.lat, control.lat, t)
      const bcLat = lerp(control.lat, end.lat, t)

      coordinates.push([
        lerp(abLng, bcLng, t),
        lerp(abLat, bcLat, t),
      ])
    }
  }

  return coordinates
}

function isValidRoute(route) {
  return Array.isArray(route) && route.length > 1 && route.every((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]))
}

function loadHudColor() {
  try {
    const stored = localStorage.getItem(HUD_COLOR_KEY)
    if (stored && /^#[0-9a-fA-F]{6}$/.test(stored)) {
      return stored
    }
  } catch {
    // Keep the app usable if localStorage is unavailable.
  }

  return DEFAULT_HUD_COLOR
}

function loadHudOpacity() {
  try {
    const stored = localStorage.getItem(HUD_OPACITY_KEY)
    const parsed = stored ? Number.parseFloat(stored) : Number.NaN
    if (Number.isFinite(parsed)) {
      return Math.min(1, Math.max(0.35, parsed))
    }
  } catch {
    // Keep the app usable if localStorage is unavailable.
  }

  return DEFAULT_HUD_OPACITY
}

function hexToRgb(hex) {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex)
  if (!match) return null

  const value = match[1]
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  }
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('')}`
}

function mixHexColors(a, b, ratio = 0.5) {
  const colorA = hexToRgb(a)
  const colorB = hexToRgb(b)
  if (!colorA || !colorB) return a

  const inverse = 1 - ratio
  return rgbToHex(
    colorA.r * ratio + colorB.r * inverse,
    colorA.g * ratio + colorB.g * inverse,
    colorA.b * ratio + colorB.b * inverse,
  )
}

function toRgbString(hex, alpha = 1) {
  const rgb = hexToRgb(hex)
  if (!rgb) return `rgb(255 255 255 / ${alpha})`

  return `rgb(${rgb.r} ${rgb.g} ${rgb.b} / ${alpha})`
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function formatGarminMetric(value, digits = 0, suffix = '') {
  if (!Number.isFinite(value)) return 'n/a'
  return `${value.toFixed(digits)}${suffix}`
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

function buildHudButtonTheme(accentHex, opacity = DEFAULT_HUD_OPACITY) {
  const accent = /^#[0-9a-fA-F]{6}$/.test(accentHex) ? accentHex : DEFAULT_HUD_COLOR
  const surfaceOpacity = clamp(opacity, 0.35, 1)
  const base = '#0a1017'
  const shadowColor = mixHexColors(accent, '#000000', 0.28)
  const text = '#f4f7fa'
  const muted = '#d6dce2'

  const tone = (bgMix, activeMix, borderMix, glowMix = bgMix) => ({
    bg: toRgbString(mixHexColors(accent, base, bgMix), surfaceOpacity),
    activeBg: `linear-gradient(180deg, ${toRgbString(mixHexColors(accent, '#ffffff', activeMix), clamp(surfaceOpacity + 0.03, 0.35, 1))}, ${toRgbString(mixHexColors(accent, base, glowMix), clamp(surfaceOpacity - 0.01, 0.35, 1))})`,
    border: toRgbString(mixHexColors(accent, '#ffffff', borderMix), clamp(surfaceOpacity - 0.08, 0.2, 0.95)),
    text,
    muted,
    shadow: `0 10px 24px ${toRgbString(shadowColor, clamp(surfaceOpacity - 0.72, 0.08, 0.22))}`,
  })

  return {
    overview: tone(0.34, 0.48, 0.5, 0.28),
    layers: tone(0.32, 0.46, 0.48, 0.26),
    selected: tone(0.38, 0.52, 0.54, 0.3),
    elevation: tone(0.35, 0.5, 0.5, 0.27),
    import: tone(0.36, 0.5, 0.52, 0.28),
    quick: tone(0.33, 0.47, 0.49, 0.26),
  }
}

function getHudButtonStyle(toneName, active = false, theme = buildHudButtonTheme(DEFAULT_HUD_COLOR, DEFAULT_HUD_OPACITY)) {
  const tone = theme[toneName] ?? theme.quick
  return {
    '--hud-btn-bg': active ? tone.activeBg : tone.bg,
    '--hud-btn-border': tone.border,
    '--hud-btn-text': tone.text,
    '--hud-btn-muted': tone.muted,
    '--hud-btn-shadow': tone.shadow,
  }
}

function getHudTone(toneName, active = false, theme) {
  return getHudButtonStyle(toneName, active, theme)
}

function matchesLogbookActivity(place, activityId) {
  if (activityId === 'all') return true
  if (activityId === 'place') return place.kind !== 'run'
  return place.kind === 'run' && (place.activityType || 'run') === activityId
}

function getLogbookTimestamp(place) {
  return Date.parse(place?.recordedAt || place?.updatedAt || place?.createdAt || '') || 0
}

const LOGBOOK_MONTH_LABELS = Array.from({ length: 12 }, (_, index) =>
  new Date(2000, index, 1).toLocaleString(undefined, { month: 'short' }),
)

function getFileManagerDefaultPosition() {
  if (typeof window === 'undefined') return { x: 96, y: 72 }

  const width = Math.min(1180, Math.max(640, window.innerWidth - 24))
  const height = Math.min(760, Math.max(520, window.innerHeight - 24))
  return {
    x: Math.max(12, Math.round(window.innerWidth / 2 - width / 2)),
    y: Math.max(12, Math.round(window.innerHeight / 2 - height / 2)),
  }
}

function App() {
  const uiState = useMemo(() => loadUiState(), [])
  const [activeLayer, setActiveLayer] = useState(uiState.activeLayer)
  const [places, setPlaces] = useState(() => loadPlaces())
  const [selectedId, setSelectedId] = useState(uiState.selectedId)
  const [importStatus, setImportStatus] = useState('')
  const [mapViewState, setMapViewState] = useState({ longitude: -80.2, latitude: 39.8, zoom: 3.2 })
  const [importedSources, setImportedSources] = useState({})
  const [fileFolders, setFileFolders] = useState(() => loadFileFolders())
  const [openGroup, setOpenGroup] = useState(null)
  const [toolMode, setToolMode] = useState('none')
  const [buttonColor, setButtonColor] = useState(() => loadHudColor())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [buttonOpacity, setButtonOpacity] = useState(() => loadHudOpacity())
  const [fileManagerOpen, setFileManagerOpen] = useState(false)
  const [measurePoints, setMeasurePoints] = useState([])
  const [elevationPoints, setElevationPoints] = useState([])
  const [drawPoints, setDrawPoints] = useState([])
  const [drawToolMode, setDrawToolMode] = useState('sketch')
  const [drawPathMode, setDrawPathMode] = useState('straight')
  const [drawPointsVisible, setDrawPointsVisible] = useState(true)
  const [drawCurveControls, setDrawCurveControls] = useState([])
  const [fileBrowserFolderId, setFileBrowserFolderId] = useState(uiState.fileBrowserFolderId)
  const [fileBrowserSort, setFileBrowserSort] = useState(uiState.fileBrowserSort)
  const [fileBrowserSearch, setFileBrowserSearch] = useState(uiState.fileBrowserSearch)
  const [fileBrowserSelectionId, setFileBrowserSelectionId] = useState(null)
  const [fileBrowserDragId, setFileBrowserDragId] = useState(null)
  const [fileBrowserDropFolderId, setFileBrowserDropFolderId] = useState(null)
  const [fileManagerDragging, setFileManagerDragging] = useState(false)
  const [fileManagerFullscreen, setFileManagerFullscreen] = useState(false)
  const [fileManagerPosition, setFileManagerPosition] = useState(() => getFileManagerDefaultPosition())
  const [placeMediaEntries, setPlaceMediaEntries] = useState([])
  const [logContextMenu, setLogContextMenu] = useState(null)
  const [mediaUploadTargetId, setMediaUploadTargetId] = useState(null)
  const [focusPlaceId, setFocusPlaceId] = useState(null)
  const [activityDrawerOpen, setActivityDrawerOpen] = useState(false)
  const [logbookView, setLogbookView] = useState(uiState.logbookView)
  const [logbookChronologicalYear, setLogbookChronologicalYear] = useState(uiState.logbookChronologicalYear)
  const [logbookChronologicalMonth, setLogbookChronologicalMonth] = useState(uiState.logbookChronologicalMonth)
  const [logbookActivityFilter, setLogbookActivityFilter] = useState(uiState.logbookActivityFilter)
  const logbookChronologicalMode = 'year'
  const logbookChronologyGroups = []
  const [screenshotOpen, setScreenshotOpen] = useState(false)
  const [screenshotDrag, setScreenshotDrag] = useState(null)
  const [screenshotRegion, setScreenshotRegion] = useState(null)
  const [screenshotPreview, setScreenshotPreview] = useState(null)
  const [screenshotIncludeLogs, setScreenshotIncludeLogs] = useState(true)
  const [logTitleDraft, setLogTitleDraft] = useState('')
  const [logRouteColorDraft, setLogRouteColorDraft] = useState(DEFAULT_ROUTE_COLOR)
  const [logPhaseDraft, setLogPhaseDraft] = useState('past')
  const [planningMilesPerDayDraft, setPlanningMilesPerDayDraft] = useState('')
  const [planningReverseDraft, setPlanningReverseDraft] = useState(false)
  const [planningDayMilesDraft, setPlanningDayMilesDraft] = useState([])
  const [planningMarkersVisible, setPlanningMarkersVisible] = useState(uiState.planningMarkersVisible)
  const [selectedRouteTerrainProfile, setSelectedRouteTerrainProfile] = useState([])
  const [activityDrawerEditMode, setActivityDrawerEditMode] = useState(false)
  const [planningToolOpen, setPlanningToolOpen] = useState(false)
  const [importedSourcesReady, setImportedSourcesReady] = useState(false)
  const fileManagerWindowRef = useRef(null)
  const fileManagerDragRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const screenshotStageRef = useRef(null)
  const mediaUploadInputRef = useRef(null)
  const suppressNextDrawClickRef = useRef(false)
  const hasInitializedActivityDrawerRef = useRef(false)
  const userSelectedPlaceRef = useRef(false)
  const restoredImportedSourceIdsRef = useRef(new Set())

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(places))
    } catch {
      // Imported files can be large; keep the app functional if storage is full.
    }
  }, [places])

  useEffect(() => {
    try {
      localStorage.setItem(HUD_COLOR_KEY, buttonColor)
    } catch {
      // The palette is optional, so ignore storage failures.
    }
  }, [buttonColor])

  useEffect(() => {
    try {
      localStorage.setItem(HUD_OPACITY_KEY, String(buttonOpacity))
    } catch {
      // The opacity setting is optional, so ignore storage failures.
    }
  }, [buttonOpacity])

  useEffect(() => {
    try {
      localStorage.setItem(FILE_FOLDERS_KEY, JSON.stringify(fileFolders))
    } catch {
      // Folder metadata is optional, so ignore storage failures.
    }
  }, [fileFolders])

  useEffect(() => {
    try {
      localStorage.setItem(
        UI_STATE_KEY,
        JSON.stringify({
          activeLayer,
          selectedId,
          logbookView,
          logbookChronologicalYear,
          logbookChronologicalMonth,
          logbookActivityFilter,
          fileBrowserFolderId,
          fileBrowserSort,
          fileBrowserSearch,
          planningMarkersVisible,
        }),
      )
    } catch {
      // UI state is optional, so ignore storage failures.
    }
  }, [activeLayer, fileBrowserFolderId, fileBrowserSearch, fileBrowserSort, logbookActivityFilter, logbookChronologicalMonth, logbookChronologicalYear, logbookView, planningMarkersVisible, selectedId])

  useEffect(() => {
    let cancelled = false

    async function loadSavedImports() {
      try {
        const next = await loadImportedSources()
        if (!cancelled) {
          setImportedSources(next)
          setImportedSourcesReady(true)
        }
      } catch {
        // Keep the app usable if the browser blocks IndexedDB.
        if (!cancelled) setImportedSourcesReady(true)
      }
    }

    loadSavedImports()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    async function restoreMissingImportedPlaces() {
      if (!importedSourcesReady || restoredImportedSourceIdsRef.current.size > 0) return

      const placeIds = new Set(places.map((place) => place.id))
      const missingEntries = Object.entries(importedSources).filter(([id, source]) => {
        if (!id || placeIds.has(id)) return false
        if (restoredImportedSourceIdsRef.current.has(id)) return false
        return Boolean(source?.sourceText || source?.sourceBytes)
      })

      if (!missingEntries.length) return

      const restoredPlaces = []
      const restoredSourceUpdates = {}
      for (const [id, source] of missingEntries) {
        restoredImportedSourceIdsRef.current.add(id)

        try {
          const fileName = source.sourceName || `${id}.${source.sourceFormat || 'fit'}`
          const fileType = source.sourceMime || 'application/octet-stream'
          const file = source.sourceBytes
            ? new File([source.sourceBytes], fileName, { type: fileType })
            : new File([source.sourceText || ''], fileName, { type: fileType })
          const imported = await importRunFile(file)
          const { sourceText, sourceBytes, sourceFormat, sourceMime, ...run } = imported
          restoredPlaces.push({ ...run, id })
          restoredSourceUpdates[id] = {
            ...source,
            sourceText: sourceText ?? source.sourceText ?? '',
            sourceBytes: sourceBytes ?? source.sourceBytes ?? null,
            sourceFormat: sourceFormat || source.sourceFormat || fileName.split('.').pop()?.toLowerCase() || '',
            sourceMime: sourceMime || source.sourceMime || fileType,
            sourceName: fileName,
            displayName: source.displayName || fileName,
            folderId: source.folderId || 'inbox',
            routeColor: source.routeColor || DEFAULT_ROUTE_COLOR,
            planMilesPerDay: source.planMilesPerDay ?? null,
            planReverseDirection: Boolean(source.planReverseDirection),
            planDayBreakpoints: Array.isArray(source.planDayBreakpoints) ? source.planDayBreakpoints : [],
            updatedAt: new Date().toISOString(),
          }
        } catch {
          // Leave the saved source alone if the file cannot be rebuilt.
        }
      }

      if (Object.keys(restoredSourceUpdates).length) {
        setImportedSources((current) => ({ ...current, ...restoredSourceUpdates }))
      }

      if (restoredPlaces.length) {
        setPlaces((current) => mergePlaces(restoredPlaces, current))
      }
    }

    restoreMissingImportedPlaces()
  }, [importedSources, importedSourcesReady, places])

  useEffect(() => {
    let cancelled = false

    async function loadSavedMedia() {
      try {
        const records = await loadAllPlaceMedia()
        if (cancelled) return

        setPlaceMediaEntries(
          records.map((record) => ({
            ...record,
            url: URL.createObjectURL(record.blob),
          })),
        )
      } catch {
        // Keep the app usable if IndexedDB media is unavailable.
      }
    }

    loadSavedMedia()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return () => {
      placeMediaEntries.forEach((entry) => {
        if (entry?.url) URL.revokeObjectURL(entry.url)
      })
    }
  }, [placeMediaEntries])

  const visiblePlaces = useMemo(() => {
    const phaseMatches = places.filter((place) => place.phase === activeLayer)
    if (activeLayer !== 'past') return phaseMatches

    let entries = phaseMatches

    if (logbookView === 'activity' && logbookActivityFilter !== 'all') {
      entries = entries.filter((entry) => {
        if (logbookActivityFilter === 'place') return entry.kind !== 'run'
        return entry.kind === 'run' && (entry.activityType || 'run') === logbookActivityFilter
      })
    }

    if (logbookView === 'chronological') {
      entries = entries.filter((entry) => {
        const time = getLogbookTimestamp(entry)
        if (!time) return false
        const date = new Date(time)
        if (Number.isFinite(logbookChronologicalYear) && date.getFullYear() !== logbookChronologicalYear) return false
        if (Number.isFinite(logbookChronologicalMonth) && date.getMonth() !== logbookChronologicalMonth) return false
        return true
      })
    }

    return entries
  }, [activeLayer, logbookActivityFilter, logbookChronologicalMonth, logbookChronologicalYear, logbookView, places])

  const selected = visiblePlaces.find((place) => place.id === selectedId) ?? null
  const hudTheme = useMemo(() => buildHudButtonTheme(buttonColor, buttonOpacity), [buttonColor, buttonOpacity])

  const selectedRouteGeoJson = useMemo(() => {
    if (!isValidRoute(selected?.route)) return null

    return { type: 'Feature', geometry: { type: 'LineString', coordinates: selected.route }, properties: {} }
  }, [selected])

  const selectedRouteColor = useMemo(() => {
    if (!selected) return DEFAULT_ROUTE_COLOR
    return selected.routeColor || importedSources[selected.id]?.routeColor || DEFAULT_ROUTE_COLOR
  }, [importedSources, selected])

  const selectedRouteMiles = useMemo(() => {
    if (!selected) return null
    const routeMiles = routeDistanceMiles(selected.route)
    if (Number.isFinite(routeMiles) && routeMiles > 0) return routeMiles

    const importedMiles = parseMilesValue(selected.distance)
    return Number.isFinite(importedMiles) && importedMiles > 0 ? importedMiles : null
  }, [selected])

  const selectedPlanMilesPerDay = useMemo(() => {
    if (!selected || selected.phase !== 'future') return null
    return parseMilesValue(selected.planMilesPerDay ?? importedSources[selected.id]?.planMilesPerDay)
  }, [importedSources, selected])

  const selectedPlanReverseDirection = useMemo(() => {
    if (!selected || selected.phase !== 'future') return false
    return Boolean(selected.planReverseDirection ?? importedSources[selected.id]?.planReverseDirection)
  }, [importedSources, selected])

  const selectedPlanDayMiles = useMemo(() => {
    if (!selected || selected.phase !== 'future') return []

    const saved = selected.planDayBreakpoints ?? importedSources[selected.id]?.planDayBreakpoints ?? selected.planDayMiles ?? importedSources[selected.id]?.planDayMiles
    return normalizePlanningDayBreakpoints(saved, selectedRouteMiles ?? 0)
  }, [importedSources, selected, selectedRouteMiles])

  const selectedPlanDays = useMemo(() => {
    if (selectedPlanDayMiles.length) return selectedPlanDayMiles.length
    if (!Number.isFinite(selectedRouteMiles) || !Number.isFinite(selectedPlanMilesPerDay) || selectedPlanMilesPerDay <= 0) return null
    return selectedRouteMiles / selectedPlanMilesPerDay
  }, [selectedPlanDayMiles.length, selectedPlanMilesPerDay, selectedRouteMiles])

  const planningMilesPerDay = useMemo(() => parseMilesValue(planningMilesPerDayDraft), [planningMilesPerDayDraft])
  const planningEstimatedDays = useMemo(() => {
    if (!Number.isFinite(selectedRouteMiles) || !Number.isFinite(planningMilesPerDay) || planningMilesPerDay <= 0) return null
    return selectedRouteMiles / planningMilesPerDay
  }, [planningMilesPerDay, selectedRouteMiles])

  const planningReverseDirection = planningToolOpen ? planningReverseDraft : selectedPlanReverseDirection
  const activePlanningDayMiles = planningToolOpen
    ? planningDayMilesDraft
    : selectedPlanDayMiles.length
      ? selectedPlanDayMiles
      : buildPlanningDayMilesList(selectedRouteMiles, selectedPlanMilesPerDay)

  const activePlanningMilesPerDay = useMemo(() => {
    if (!selected || selected.phase !== 'future') return null
    if (planningToolOpen) return planningMilesPerDay
    return selectedPlanMilesPerDay
  }, [planningMilesPerDay, planningToolOpen, selected, selectedPlanMilesPerDay])

  useEffect(() => {
    if (!planningToolOpen || !selected || selected.phase !== 'future') return
    if (!Number.isFinite(planningMilesPerDay) || planningMilesPerDay <= 0) return
    if (!Number.isFinite(selectedRouteMiles) || selectedRouteMiles <= 0) return

    setPlanningDayMilesDraft(buildPlanningDayMilesList(selectedRouteMiles, planningMilesPerDay))
  }, [planningMilesPerDay, planningToolOpen, selected, selectedRouteMiles])

  const routePlanningAnalysis = useMemo(() => {
    if (!selected || selected.phase !== 'future') return { markers: [], days: [] }
    if (!Number.isFinite(activePlanningMilesPerDay) || activePlanningMilesPerDay <= 0) return { markers: [], days: [] }
    return buildRoutePlanningAnalysis(selected.route, activePlanningDayMiles.length ? activePlanningDayMiles : activePlanningMilesPerDay, planningReverseDirection, selectedRouteMiles)
  }, [activePlanningDayMiles, activePlanningMilesPerDay, planningReverseDirection, selected, selectedRouteMiles])

  const plannedRouteMarkers = routePlanningAnalysis.markers
  const elevationProfileGraph = useMemo(() => buildElevationProfileGraph(selectedRouteTerrainProfile), [selectedRouteTerrainProfile])

  const selectedRouteElevationGain = useMemo(() => {
    if (!Array.isArray(selectedRouteTerrainProfile) || selectedRouteTerrainProfile.length < 2) return null

    const elevations = selectedRouteTerrainProfile
      .map((point) => point?.elevation)
      .filter((value) => Number.isFinite(value))

    if (elevations.length < 2) return null

    let gain = 0
    for (let index = 1; index < elevations.length; index += 1) {
      const delta = elevations[index] - elevations[index - 1]
      if (delta > 0) gain += delta
    }

    return gain
  }, [selectedRouteTerrainProfile])

  const selectedMediaEntries = useMemo(() => {
    if (!selected) return []
    return placeMediaEntries.filter((entry) => entry.placeId === selected.id)
  }, [placeMediaEntries, selected])

  const measureLineGeoJson = useMemo(() => {
    if (measurePoints.length < 2) return null

    return {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: measurePoints.map((point) => [point.lng, point.lat]),
      },
      properties: {},
    }
  }, [measurePoints])

  const elevationLineGeoJson = useMemo(() => {
    if (elevationPoints.length < 2) return null

    return {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: elevationPoints.map((point) => [point.lng, point.lat]),
      },
      properties: {},
    }
  }, [elevationPoints])

  const elevationPointsGeoJson = useMemo(() => {
    if (!elevationPoints.length) return null

    return {
      type: 'FeatureCollection',
      features: elevationPoints.map((point, index) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [point.lng, point.lat] },
        properties: { index: index + 1, elevation: point.elevation },
      })),
    }
  }, [elevationPoints])

  const measureDistanceMeters = useMemo(() => {
    if (measurePoints.length < 2) return 0

    return measurePoints.slice(1).reduce((total, point, index) => {
      const previous = measurePoints[index]
      return total + haversineMeters(previous, point)
    }, 0)
  }, [measurePoints])

  const measureSummary = useMemo(() => {
    if (!measurePoints.length) return 'Click the map to add measure points.'
    const pointLabel = `${measurePoints.length} point${measurePoints.length === 1 ? '' : 's'}`
    const distanceLabel = measureDistanceMeters ? `${formatFeet(measureDistanceMeters)} / ${(measureDistanceMeters / 1609.344).toFixed(2)} mi` : '0 ft'
    return `${pointLabel} • ${distanceLabel}`
  }, [measureDistanceMeters, measurePoints.length])

  const measureSummaryText = measureSummary.replace(/â€¢|•/g, '·')

  const elevationSummary = useMemo(() => {
    if (!elevationPoints.length) return 'Click the map to sample elevation.'

    const availableElevations = elevationPoints.map((point) => point.elevation).filter((value) => Number.isFinite(value))
    const pointLabel = `${elevationPoints.length} point${elevationPoints.length === 1 ? '' : 's'}`

    if (!availableElevations.length) {
      return `${pointLabel} · Waiting for terrain`
    }

    if (elevationPoints.length === 1) {
      return `${pointLabel} · ${formatFeetValue(availableElevations[0])}`
    }

    const low = Math.min(...availableElevations)
    const high = Math.max(...availableElevations)
    return `${pointLabel} · Low ${formatFeetValue(low)} / High ${formatFeetValue(high)}`
  }, [elevationPoints])

  const elevationStats = useMemo(() => {
    if (!elevationPoints.length) return null

    const elevations = elevationPoints.map((point) => point.elevation).filter((value) => Number.isFinite(value))
    if (!elevations.length) {
      return { count: elevationPoints.length, current: null, low: null, high: null, delta: null, gain: null, loss: null }
    }

    const low = Math.min(...elevations)
    const high = Math.max(...elevations)
    let gain = 0
    let loss = 0

    for (let index = 1; index < elevationPoints.length; index += 1) {
      const previous = elevationPoints[index - 1]?.elevation
      const current = elevationPoints[index]?.elevation
      if (!Number.isFinite(previous) || !Number.isFinite(current)) continue

      const delta = current - previous
      if (delta > 0) gain += delta
      if (delta < 0) loss += Math.abs(delta)
    }

    return {
      count: elevationPoints.length,
      current: elevationPoints[elevationPoints.length - 1],
      low,
      high,
      delta: high - low,
      gain,
      loss,
    }
  }, [elevationPoints])

  const drawLineGeoJson = useMemo(() => {
    if (drawPoints.length < 2) return null

    return {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: drawPoints.map((point) => [point.lng, point.lat]),
      },
      properties: {},
    }
  }, [drawPoints])

  const drawSummaryText = useMemo(() => {
    if (!drawPoints.length) return 'Click the map to sketch points.'
    return `${drawPoints.length} point${drawPoints.length === 1 ? '' : 's'} · Ready to keep sketching`
  }, [drawPoints.length])

  const drawCurveGeoJson = useMemo(() => {
    const coordinates = buildBezierCurveCoordinates(drawPoints, drawCurveControls)
    if (coordinates.length < 2) return null

    return {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates,
      },
      properties: {},
    }
  }, [drawCurveControls, drawPoints])

  const drawDisplayGeoJson = drawPathMode === 'curve' ? drawCurveGeoJson : drawLineGeoJson

  const drawExportGeoJson = useMemo(() => {
    if (!drawPoints.length) return null

    const features = []

    if (drawDisplayGeoJson?.geometry?.type === 'LineString' && drawDisplayGeoJson.geometry.coordinates?.length >= 2) {
      features.push({
        type: 'Feature',
        geometry: drawDisplayGeoJson.geometry,
        properties: {
          kind: 'draw-path',
          mode: drawPathMode,
          pointCount: drawPoints.length,
        },
      })
    }

    features.push(
      ...drawPoints.map((point, index) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [point.lng, point.lat],
        },
        properties: {
          kind: 'draw-point',
          index: index + 1,
        },
      })),
    )

    return {
      type: 'FeatureCollection',
      properties: {
        createdAt: new Date().toISOString(),
        mode: drawPathMode,
        tool: 'draw',
      },
      features,
    }
  }, [drawDisplayGeoJson, drawPathMode, drawPoints])

  const drawPointsGeoJson = useMemo(() => {
    if (!drawPoints.length) return null

    return {
      type: 'FeatureCollection',
      features: drawPoints.map((point, index) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [point.lng, point.lat] },
        properties: { index: index + 1 },
      })),
    }
  }, [drawPoints])

  const drawCurveControlPoints = useMemo(() => {
    if (drawPathMode !== 'curve' || drawPoints.length < 2) return []

    return drawPoints.slice(0, -1).map((point, index) => {
      const next = drawPoints[index + 1]
      return {
        index,
        lng: drawCurveControls[index]?.lng ?? (point.lng + next.lng) / 2,
        lat: drawCurveControls[index]?.lat ?? (point.lat + next.lat) / 2,
      }
    })
  }, [drawCurveControls, drawPathMode, drawPoints])

  const drawModeLabel =
    drawToolMode === 'erase' ? 'Erase mode' : drawToolMode === 'adjust' ? 'Adjust mode' : drawPathMode === 'curve' ? 'Curve mode' : 'Sketch mode'
  const drawPointsToggleLabel = drawPointsVisible ? 'Hide joints' : 'Show joints'
  const drawCurveRadiusLabel = drawPathMode === 'curve' ? 'Drag curve handles' : 'Curve handles off'

  const selectedGarminMetrics = selected?.kind === 'run' ? selected.garminMetrics ?? null : null
  const importedSource = selected ? importedSources[selected.id] : null
  const selectedGarminItems = selectedGarminMetrics
    ? [
        { label: 'Activity', value: selected.activityLabel || 'Run' },
        { label: 'Status', value: selected.status || 'Imported activity' },
        selected.activityType ? { label: 'Type', value: titleCase(selected.activityType) } : null,
        selected.importedFrom ? { label: 'Source file', value: selected.importedFrom } : null,
        selected.recordedAt ? { label: 'Recorded', value: new Date(selected.recordedAt).toLocaleString() } : null,
        selected.distance ? { label: 'Distance', value: selected.distance } : null,
        selected.duration ? { label: 'Duration', value: selected.duration } : null,
        selectedGarminMetrics.samples?.records ? { label: 'Record points', value: `${formatGarminMetric(selectedGarminMetrics.samples.records)}` } : null,
        selectedGarminMetrics.samples?.laps ? { label: 'Laps', value: `${formatGarminMetric(selectedGarminMetrics.samples.laps)}` } : null,
        selectedGarminMetrics.heartRate?.avg ? { label: 'Avg HR', value: `${formatGarminMetric(selectedGarminMetrics.heartRate.avg)} bpm` } : null,
        selectedGarminMetrics.heartRate?.max ? { label: 'Max HR', value: `${formatGarminMetric(selectedGarminMetrics.heartRate.max)} bpm` } : null,
        selectedGarminMetrics.cadence?.avg ? { label: 'Avg Cadence', value: `${formatGarminMetric(selectedGarminMetrics.cadence.avg)} spm` } : null,
        selectedGarminMetrics.cadence?.max ? { label: 'Max Cadence', value: `${formatGarminMetric(selectedGarminMetrics.cadence.max)} spm` } : null,
        selectedGarminMetrics.speed?.avg ? { label: 'Avg Speed', value: `${formatGarminMetric(selectedGarminMetrics.speed.avg, 1)} mph` } : null,
        selectedGarminMetrics.speed?.max ? { label: 'Max Speed', value: `${formatGarminMetric(selectedGarminMetrics.speed.max, 1)} mph` } : null,
        selectedGarminMetrics.power?.avg ? { label: 'Avg Power', value: `${formatGarminMetric(selectedGarminMetrics.power.avg)} W` } : null,
        selectedGarminMetrics.power?.max ? { label: 'Max Power', value: `${formatGarminMetric(selectedGarminMetrics.power.max)} W` } : null,
        selectedGarminMetrics.altitude?.gain ? { label: 'Recorded ascent', value: `${formatGarminMetric(selectedGarminMetrics.altitude.gain)} ft` } : null,
        selectedGarminMetrics.altitude?.loss ? { label: 'Recorded descent', value: `${formatGarminMetric(selectedGarminMetrics.altitude.loss)} ft` } : null,
        selectedGarminMetrics.altitude?.max ? { label: 'Highest altitude', value: `${formatGarminMetric(selectedGarminMetrics.altitude.max)} ft` } : null,
        selectedGarminMetrics.altitude?.min ? { label: 'Lowest altitude', value: `${formatGarminMetric(selectedGarminMetrics.altitude.min)} ft` } : null,
        selectedGarminMetrics.temperature?.avg ? { label: 'Avg Temp', value: `${formatGarminMetric(selectedGarminMetrics.temperature.avg, 1)} °C` } : null,
        selectedGarminMetrics.temperature?.max ? { label: 'Max Temp', value: `${formatGarminMetric(selectedGarminMetrics.temperature.max, 1)} °C` } : null,
        selectedGarminMetrics.temperature?.min ? { label: 'Min Temp', value: `${formatGarminMetric(selectedGarminMetrics.temperature.min, 1)} °C` } : null,
      ].filter(Boolean)
    : []
  const screenshotSelectionBox = useMemo(() => {
    const region = screenshotDrag || screenshotRegion
    if (!region) return null

    const left = Math.min(region.startX ?? region.left, region.endX ?? (region.left + region.width))
    const top = Math.min(region.startY ?? region.top, region.endY ?? (region.top + region.height))
    const width = Math.abs((region.endX ?? (region.left + region.width)) - (region.startX ?? region.left))
    const height = Math.abs((region.endY ?? (region.top + region.height)) - (region.startY ?? region.top))

    if (!width || !height) return null

    return { left, top, width, height }
  }, [screenshotDrag, screenshotRegion])
  const importedFileEntries = useMemo(() => {
    return Object.entries(importedSources)
      .map(([id, source]) => ({
        id,
        displayName: source?.displayName || source?.sourceName || source?.sourceFormat || 'Imported file',
        sourceName: source?.sourceName || source?.sourceFormat || 'Imported file',
        sourceFormat: source?.sourceFormat || '',
        folderId: source?.folderId || 'inbox',
        updatedAt: source?.updatedAt || null,
        place: places.find((item) => item.id === id) || null,
      }))
      .sort((a, b) => {
        const aTime = a.updatedAt ? Date.parse(a.updatedAt) : 0
        const bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0
        return bTime - aTime
      })
  }, [importedSources, places])

  const fileBrowserItems = useMemo(() => {
    const query = fileBrowserSearch.trim().toLowerCase()

    const matchesFolder = (entry) => {
      if (fileBrowserFolderId === 'all') return true
      return (entry.folderId || 'inbox') === fileBrowserFolderId
    }

    const matchesSearch = (entry) => {
      if (!query) return true
      const haystack = [
        entry.displayName,
        entry.sourceName,
        entry.sourceFormat,
        entry.place?.name,
        entry.place?.status,
        entry.folderId,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(query)
    }

    const sortEntries = (items) => {
      const next = [...items]

      switch (fileBrowserSort) {
        case 'name':
          return next.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''))
        case 'type':
          return next.sort((a, b) => (a.sourceFormat || '').localeCompare(b.sourceFormat || '') || (a.displayName || '').localeCompare(b.displayName || ''))
        case 'date':
        default:
          return next.sort((a, b) => {
            const aTime = a.updatedAt ? Date.parse(a.updatedAt) : 0
            const bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0
            if (bTime !== aTime) return bTime - aTime
            return (a.displayName || '').localeCompare(b.displayName || '')
          })
      }
    }

    return sortEntries(importedFileEntries.filter(matchesFolder).filter(matchesSearch))
  }, [fileBrowserFolderId, fileBrowserSearch, fileBrowserSort, importedFileEntries])

  const fileBrowserSelection = useMemo(() => {
    return fileBrowserItems.find((entry) => entry.id === fileBrowserSelectionId) || fileBrowserItems[0] || null
  }, [fileBrowserItems, fileBrowserSelectionId])

  const fileBrowserFolderMeta = useMemo(() => {
    if (fileBrowserFolderId === 'all') return { id: 'all', name: 'All files', builtIn: true }
    return fileFolders.find((folder) => folder.id === fileBrowserFolderId) || null
  }, [fileBrowserFolderId, fileFolders])

  const folderCounts = useMemo(() => {
    const counts = importedFileEntries.reduce((accumulator, entry) => {
      const folderId = entry.folderId || 'inbox'
      accumulator[folderId] = (accumulator[folderId] || 0) + 1
      return accumulator
    }, {})

    return counts
  }, [importedFileEntries])

  const fileBrowserFolders = useMemo(() => {
    const inboxFolder = fileFolders.find((folder) => folder.id === 'inbox') || DEFAULT_FILE_FOLDERS[0]
    const customFolders = fileFolders
      .filter((folder) => folder.id !== 'inbox')
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))

    return [
      { id: 'all', name: 'All files', builtIn: true, count: importedFileEntries.length },
      { ...inboxFolder, count: folderCounts[inboxFolder.id] || 0 },
      ...customFolders.map((folder) => ({
        ...folder,
        count: folderCounts[folder.id] || 0,
      })),
    ]
  }, [fileFolders, folderCounts, importedFileEntries.length])

  const logbookPastEntries = useMemo(() => places.filter((place) => place.phase === 'past'), [places])

  const logbookChronologyYears = useMemo(() => {
    return [...new Set(logbookPastEntries.map((place) => {
      const time = getLogbookTimestamp(place)
      return time ? new Date(time).getFullYear() : null
    }).filter((value) => Number.isFinite(value)))].sort((a, b) => b - a)
  }, [logbookPastEntries])

  const logbookChronologyMonths = useMemo(() => {
    if (!Number.isFinite(logbookChronologicalYear)) return []

    return [...new Set(logbookPastEntries.map((place) => {
      const time = getLogbookTimestamp(place)
      if (!time) return null
      const date = new Date(time)
      if (date.getFullYear() !== logbookChronologicalYear) return null
      return date.getMonth()
    }).filter((value) => Number.isFinite(value)))].sort((a, b) => b - a)
  }, [logbookPastEntries, logbookChronologicalYear])

  const showLegacyLogbookList = logbookChronologyYears.length < 0

  const logbookEntries = useMemo(() => {
    const sortByChronological = (a, b) => {
      const aTime = getLogbookTimestamp(a)
      const bTime = getLogbookTimestamp(b)
      if (bTime !== aTime) return bTime - aTime
      return a.name.localeCompare(b.name)
    }

    const sortByActivity = (a, b) => {
      const aKey = a.kind === 'run' ? a.activityType || 'run' : 'place'
      const bKey = b.kind === 'run' ? b.activityType || 'run' : 'place'
      const aOrder = LOGBOOK_ACTIVITY_ORDER.indexOf(aKey)
      const bOrder = LOGBOOK_ACTIVITY_ORDER.indexOf(bKey)
      if (aOrder !== bOrder) return aOrder - bOrder
      return sortByChronological(a, b)
    }

    let entries = [...logbookPastEntries]

    if (logbookView === 'activity' && logbookActivityFilter !== 'all') {
      entries = entries.filter((entry) => {
        if (logbookActivityFilter === 'place') return entry.kind !== 'run'
        return entry.kind === 'run' && (entry.activityType || 'run') === logbookActivityFilter
      })
    }

    if (logbookView === 'chronological') {
      entries = entries.filter((entry) => {
        const time = getLogbookTimestamp(entry)
        if (!time) return false
        const date = new Date(time)
        if (Number.isFinite(logbookChronologicalYear) && date.getFullYear() !== logbookChronologicalYear) return false
        if (Number.isFinite(logbookChronologicalMonth) && date.getMonth() !== logbookChronologicalMonth) return false
        return true
      })
      return entries.sort(sortByChronological)
    }

    return entries.sort(sortByActivity)
  }, [logbookActivityFilter, logbookChronologicalMonth, logbookChronologicalYear, logbookPastEntries, logbookView])

  useEffect(() => {
    if (logbookView !== 'activity') {
      setLogbookActivityFilter('all')
    }
  }, [logbookView])

  useEffect(() => {
    if (logbookView !== 'chronological') return
    if (!logbookChronologyYears.length) {
      if (logbookChronologicalYear !== null) setLogbookChronologicalYear(null)
      if (logbookChronologicalMonth !== null) setLogbookChronologicalMonth(null)
      return
    }

    const nextYear = logbookChronologyYears.includes(logbookChronologicalYear)
      ? logbookChronologicalYear
      : logbookChronologyYears[0]

    if (nextYear !== logbookChronologicalYear) {
      setLogbookChronologicalYear(nextYear)
    }
  }, [logbookChronologyYears, logbookChronologicalYear, logbookChronologicalMonth, logbookView])

  useEffect(() => {
    if (logbookView !== 'chronological') return
    if (!Number.isFinite(logbookChronologicalYear)) {
      if (logbookChronologicalMonth !== null) setLogbookChronologicalMonth(null)
      return
    }

    if (!logbookChronologyMonths.length) {
      if (logbookChronologicalMonth !== null) setLogbookChronologicalMonth(null)
      return
    }

    const nextMonth = logbookChronologyMonths.includes(logbookChronologicalMonth)
      ? logbookChronologicalMonth
      : logbookChronologyMonths[0]

    if (nextMonth !== logbookChronologicalMonth) {
      setLogbookChronologicalMonth(nextMonth)
    }
  }, [logbookChronologicalMonth, logbookChronologicalYear, logbookChronologyMonths, logbookView])

  useEffect(() => {
    if (activeLayer !== 'past') return

    if (logbookView === 'activity') {
      if (logbookActivityFilter === 'all') return
      if (selected && matchesLogbookActivity(selected, logbookActivityFilter)) return
    }

    if (logbookView === 'chronological') {
      if (selected && visiblePlaces.some((place) => place.id === selected.id)) return
    }

    if (selected && visiblePlaces.some((place) => place.id === selected.id)) return

    const nextSelected = visiblePlaces[0]
    if (nextSelected) {
      setSelectedId(nextSelected.id)
      return
    }

    const fallback = places.find((place) => place.phase === 'past')
    if (fallback) {
      setSelectedId(fallback.id)
    }
  }, [activeLayer, logbookActivityFilter, logbookView, places, selected, visiblePlaces])

  useEffect(() => {
    if (!fileManagerOpen) return

    if (!fileBrowserSelectionId && fileBrowserItems.length) {
      setFileBrowserSelectionId(fileBrowserItems[0].id)
      return
    }

    if (fileBrowserSelectionId && !fileBrowserItems.some((entry) => entry.id === fileBrowserSelectionId)) {
      setFileBrowserSelectionId(fileBrowserItems[0]?.id || null)
    }
  }, [fileBrowserItems, fileBrowserSelectionId, fileManagerOpen])

  useEffect(() => {
    if (!fileManagerOpen) return
    if (fileManagerFullscreen) return

    setFileManagerPosition((current) => {
      const fallback = getFileManagerDefaultPosition()
      return {
        x: Number.isFinite(current.x) ? current.x : fallback.x,
        y: Number.isFinite(current.y) ? current.y : fallback.y,
      }
    })
  }, [fileManagerFullscreen, fileManagerOpen])

  useEffect(() => {
    if (!fileManagerOpen) return

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setFileManagerOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [fileManagerOpen])

  useEffect(() => {
    if (!fileManagerDragging) return

    const handlePointerMove = (event) => {
      const drag = fileManagerDragRef.current
      const windowNode = fileManagerWindowRef.current
      if (!drag || !windowNode) return

      const width = windowNode.offsetWidth
      const height = windowNode.offsetHeight
      const maxX = Math.max(12, window.innerWidth - width - 12)
      const maxY = Math.max(12, window.innerHeight - height - 12)
      const nextX = Math.min(maxX, Math.max(12, event.clientX - drag.offsetX))
      const nextY = Math.min(maxY, Math.max(12, event.clientY - drag.offsetY))
      setFileManagerPosition({ x: nextX, y: nextY })
    }

    const handlePointerUp = () => {
      fileManagerDragRef.current = null
      setFileManagerDragging(false)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [fileManagerDragging])

  useEffect(() => {
    if (!logContextMenu) return

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setLogContextMenu(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [logContextMenu])

  useEffect(() => {
    if (fileManagerOpen) return
    setFileManagerDragging(false)
    setFileManagerFullscreen(false)
    fileManagerDragRef.current = null
    setFileBrowserDragId(null)
    setFileBrowserDropFolderId(null)
    setFileManagerPosition(getFileManagerDefaultPosition())
  }, [fileManagerOpen])

  useEffect(() => {
    if (!screenshotOpen) {
      setScreenshotDrag(null)
      setScreenshotRegion(null)
      setScreenshotPreview((current) => {
        if (current?.url) URL.revokeObjectURL(current.url)
        return null
      })
    }
  }, [screenshotOpen])

  useEffect(() => {
    if (toolMode !== 'measure' && measurePoints.length) {
      setMeasurePoints([])
    }
  }, [measurePoints.length, toolMode])

  useEffect(() => {
    if (toolMode !== 'elevation' && elevationPoints.length) {
      setElevationPoints([])
    }
  }, [elevationPoints.length, toolMode])

  useEffect(() => {
    if (toolMode !== 'draw' && drawPoints.length) {
      setDrawPoints([])
    }
  }, [drawPoints.length, toolMode])

  useEffect(() => {
    if (toolMode !== 'draw' && drawCurveControls.length) {
      setDrawCurveControls([])
    }
  }, [drawCurveControls.length, toolMode])

  useEffect(() => {
    if (toolMode !== 'draw' && drawToolMode !== 'sketch') {
      setDrawToolMode('sketch')
    }
  }, [drawToolMode, toolMode])

  useEffect(() => {
    if (toolMode !== 'draw' && drawPathMode !== 'straight') {
      setDrawPathMode('straight')
    }
  }, [drawPathMode, toolMode])

  useEffect(() => {
    if (toolMode !== 'draw' && !drawPointsVisible) {
      setDrawPointsVisible(true)
    }
  }, [drawPointsVisible, toolMode])

  const hudTone = (toneName, active = false) => getHudTone(toneName, active, hudTheme)

  useEffect(() => {
    if (!hasInitializedActivityDrawerRef.current) {
      hasInitializedActivityDrawerRef.current = true
      return
    }

    if (!userSelectedPlaceRef.current) return
    setActivityDrawerOpen(Boolean(selected && selected.kind !== 'waypoint'))
  }, [selected])

  useEffect(() => {
    setLogTitleDraft(selected?.name || '')
  }, [selected])

  useEffect(() => {
    setLogRouteColorDraft(selectedRouteColor)
  }, [selectedRouteColor])

  useEffect(() => {
    setLogPhaseDraft(selected?.phase || 'past')
  }, [selected])

  useEffect(() => {
    if (!selected || selected.phase !== 'future') {
      setPlanningMilesPerDayDraft('')
      return
    }

    const importedPlan = selected.planMilesPerDay ?? importedSources[selected.id]?.planMilesPerDay ?? ''
    setPlanningMilesPerDayDraft(importedPlan === '' ? '' : String(importedPlan))
  }, [importedSources, selected])

  useEffect(() => {
    if (!selected || selected.phase !== 'future') {
      setPlanningReverseDraft(false)
      return
    }

    setPlanningReverseDraft(Boolean(selected.planReverseDirection ?? importedSources[selected.id]?.planReverseDirection))
  }, [importedSources, selected, selectedRouteMiles])

  useEffect(() => {
    if (!selected || selected.phase !== 'future') {
      setPlanningDayMilesDraft([])
      return
    }

    const savedDayMiles = selected.planDayBreakpoints ?? importedSources[selected.id]?.planDayBreakpoints ?? selected.planDayMiles ?? importedSources[selected.id]?.planDayMiles
    if (Array.isArray(savedDayMiles) && savedDayMiles.length) {
      const next = normalizePlanningDayBreakpoints(savedDayMiles, selectedRouteMiles ?? 0)
      setPlanningDayMilesDraft(next)
      return
    }

    setPlanningDayMilesDraft([])
  }, [importedSources, selected, selectedRouteMiles])

  function setRunActivityType(placeId, activityType) {
    const option = ACTIVITY_TYPES.find((item) => item.id === activityType) ?? ACTIVITY_TYPES[0]

    setPlaces((current) =>
      current.map((place) =>
        place.id === placeId
          ? {
              ...place,
              activityType: option.id,
              activityLabel: option.label,
              status: `${option.label} imported`,
            }
          : place,
      ),
    )
  }

  async function importOneFile(file) {
    const imported = await importRunFile(file)
    const { sourceText, sourceBytes, sourceFormat, sourceMime, ...run } = imported
    setPlaces((current) => [run, ...current])

    if (sourceText || sourceBytes) {
      const sourceRecord = {
        sourceText: sourceText ?? '',
        sourceBytes: sourceBytes ?? null,
        sourceFormat,
        sourceMime,
        sourceName: file.name,
        displayName: file.name,
        folderId: 'inbox',
        routeColor: DEFAULT_ROUTE_COLOR,
      }
      setImportedSources((current) => ({ ...current, [run.id]: sourceRecord }))
      saveImportedSource(run.id, sourceRecord).catch(() => {
        // Keep the imported run available even if persistence fails.
      })
    }

    return run
  }

  async function handleImport(event) {
    const files = Array.from(event.target.files || []).filter((file) => {
      const extension = file.name.split('.').pop()?.toLowerCase()
      return extension ? IMPORT_EXTENSIONS.includes(extension) : false
    })
    if (!files.length) return

    setImportStatus(files.length === 1 ? `Importing ${files[0].name}...` : `Importing ${files.length} files...`)

    try {
      const settledRuns = await Promise.allSettled(files.map((file) => importOneFile(file)))
      const importedRuns = []
      const importedFiles = []
      const failedFiles = []

      settledRuns.forEach((result, index) => {
        const file = files[index]

        if (result.status === 'fulfilled') {
          importedRuns.push(result.value)
          importedFiles.push(file?.name || 'Unknown file')
          return
        }

        failedFiles.push(file?.name || 'Unknown file')
      })

      if (importedRuns.length) {
        const lastRun = importedRuns[importedRuns.length - 1]
        const lastImportedFile = importedFiles[importedFiles.length - 1] || files[0].name
        setSelectedId(lastRun.id)
        setActiveLayer('past')
        if (failedFiles.length) {
          setImportStatus(
            importedRuns.length === 1
              ? `Imported ${lastRun.name} from ${lastImportedFile}; ${failedFiles.length} file failed.`
              : `Imported ${importedRuns.length} files; ${failedFiles.length} file failed.`,
          )
        } else {
          setImportStatus(importedRuns.length === 1 ? `Imported ${lastRun.name} from ${lastImportedFile}.` : `Imported ${importedRuns.length} files.`)
        }
      } else if (failedFiles.length) {
        setImportStatus(failedFiles.length === 1 ? `Could not import ${failedFiles[0]}.` : `Could not import any of the ${failedFiles.length} selected files.`)
      }
    } finally {
      event.target.value = ''
    }
  }

  function downloadImportedSource(source, filename) {
    if (!source || !filename) return

    const payload = source.sourceBytes ?? source.sourceText
    if (!payload) return

    const blob = new Blob([payload], { type: source.sourceMime || 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
  }

  function saveImportedFile() {
    const imported = importedSources[selected?.id]
    if (!imported?.sourceText && !imported?.sourceBytes) return

    downloadImportedSource(imported, selected?.importedFrom)
  }

  function saveImportedEntry(placeId) {
    const imported = importedSources[placeId]
    const target = places.find((place) => place.id === placeId)
    if (!imported || !target?.importedFrom) return

    downloadImportedSource(imported, target.importedFrom)
  }

  function getSelectedImportedSource(id = fileBrowserSelectionId) {
    if (!id) return null
    return importedSources[id] || null
  }

  function persistImportedSource(id, patch) {
    const current = getSelectedImportedSource(id)
    if (!current) return

    const next = { ...current, ...patch }
    setImportedSources((state) => ({ ...state, [id]: next }))
    saveImportedSource(id, next).catch(() => {
      // Keep the browser usable even if IndexedDB persistence fails.
    })
  }

  function selectFileFolder(folderId) {
    setFileBrowserFolderId(folderId)
    setFileBrowserSelectionId(null)
  }

  function createNewFolder() {
    const name = window.prompt('Folder name')
    if (!name?.trim()) return

    const trimmed = name.trim()
    if (fileFolders.some((folder) => folder.name.toLowerCase() === trimmed.toLowerCase())) return

    setFileFolders((current) => [
      ...current,
      { id: createFolderId(trimmed), name: trimmed, builtIn: false },
    ])
  }

  function renameFolder(folderId) {
    const folder = fileFolders.find((item) => item.id === folderId)
    if (!folder || folder.builtIn) return

    const nextName = window.prompt('Rename folder', folder.name)
    if (!nextName?.trim()) return

    const trimmed = nextName.trim()
    setFileFolders((current) =>
      current.map((item) => (item.id === folderId ? { ...item, name: trimmed } : item)),
    )
  }

  function deleteFolder(folderId) {
    const folder = fileFolders.find((item) => item.id === folderId)
    if (!folder || folder.builtIn) return

    setImportedSources((current) => {
      const next = { ...current }
      Object.entries(next).forEach(([id, source]) => {
        if ((source.folderId || 'inbox') !== folderId) return
        next[id] = { ...source, folderId: 'inbox' }
        saveImportedSource(id, next[id]).catch(() => {})
      })
      return next
    })

    setFileFolders((current) => current.filter((item) => item.id !== folderId))
    if (fileBrowserFolderId === folderId) {
      setFileBrowserFolderId('all')
      setFileBrowserSelectionId(null)
    }
  }

  function renameSelectedImportedFile() {
    const current = getSelectedImportedSource(fileBrowserSelectionId)
    if (!current) return

    const nextName = window.prompt('Rename file', current.displayName || current.sourceName || 'Imported file')
    if (!nextName?.trim()) return

    persistImportedSource(fileBrowserSelectionId, { displayName: nextName.trim() })
  }

  function moveSelectedImportedFile(folderId) {
    const current = getSelectedImportedSource(fileBrowserSelectionId)
    if (!current) return

    persistImportedSource(fileBrowserSelectionId, { folderId })
  }

  function moveImportedFile(fileId, folderId) {
    const current = getSelectedImportedSource(fileId)
    if (!current) return

    persistImportedSource(fileId, { folderId })
  }

  function updateImportedRouteColor(fileId, routeColor) {
    const current = getSelectedImportedSource(fileId)
    if (!current) return

    persistImportedSource(fileId, { routeColor })
  }

  function updateLogDetails(placeId, patch) {
    if (!placeId || !patch) return

    setPlaces((current) =>
      current.map((place) => {
        if (place.id !== placeId) return place
        return {
          ...place,
          ...(typeof patch.name === 'string' ? { name: patch.name } : {}),
          ...(typeof patch.routeColor === 'string' ? { routeColor: patch.routeColor } : {}),
          ...(typeof patch.phase === 'string' ? { phase: patch.phase } : {}),
          ...(patch.planMilesPerDay !== undefined ? { planMilesPerDay: patch.planMilesPerDay } : {}),
          ...(patch.planReverseDirection !== undefined ? { planReverseDirection: patch.planReverseDirection } : {}),
          ...(patch.planDayBreakpoints !== undefined ? { planDayBreakpoints: patch.planDayBreakpoints } : {}),
        }
      }),
    )

    if (importedSources[placeId]) {
      const importedPatch = {}
      if (typeof patch.name === 'string') importedPatch.displayName = patch.name
      if (typeof patch.routeColor === 'string') importedPatch.routeColor = patch.routeColor
      if (typeof patch.phase === 'string') importedPatch.phase = patch.phase
      if (patch.planMilesPerDay !== undefined) importedPatch.planMilesPerDay = patch.planMilesPerDay
      if (patch.planReverseDirection !== undefined) importedPatch.planReverseDirection = patch.planReverseDirection
      if (patch.planDayBreakpoints !== undefined) importedPatch.planDayBreakpoints = patch.planDayBreakpoints
      if (Object.keys(importedPatch).length) {
        persistImportedSource(placeId, importedPatch)
      }
    }
  }

  function saveSelectedLogEdits() {
    if (!selected || selected.kind === 'waypoint') return

    const nextTitle = logTitleDraft.trim()
    const nextRouteColor = logRouteColorDraft || DEFAULT_ROUTE_COLOR
    const nextPhase = logPhaseDraft === 'future' ? 'future' : 'past'
    const nextPatch = {}

    if (nextTitle && nextTitle !== selected.name) {
      nextPatch.name = nextTitle
    }

    if (selectedRouteGeoJson && nextRouteColor !== selectedRouteColor) {
      nextPatch.routeColor = nextRouteColor
    }

    if (selected.phase === 'past' || selected.phase === 'future') {
      nextPatch.phase = nextPhase
    }

    if (Object.keys(nextPatch).length) {
      updateLogDetails(selected.id, nextPatch)
    }

    setActivityDrawerEditMode(false)
  }

  function togglePlanningTools() {
    if (!selected || selected.phase !== 'future') return
    setPlanningToolOpen((current) => !current)

    if (!planningToolOpen) {
      setActivityDrawerEditMode(false)
      const importedPlanMilesPerDay = selected.planMilesPerDay ?? importedSources[selected.id]?.planMilesPerDay ?? 10
      const nextMilesPerDay = Number.isFinite(parseMilesValue(importedPlanMilesPerDay))
        ? parseMilesValue(importedPlanMilesPerDay)
        : 10
      setPlanningMilesPerDayDraft(String(nextMilesPerDay))
      const savedDayMiles = selected.planDayBreakpoints ?? importedSources[selected.id]?.planDayBreakpoints ?? selected.planDayMiles ?? importedSources[selected.id]?.planDayMiles
      const nextDayMiles = Array.isArray(savedDayMiles) && savedDayMiles.length
        ? normalizePlanningDayBreakpoints(savedDayMiles, selectedRouteMiles ?? 0)
        : buildPlanningDayMilesList(selectedRouteMiles, nextMilesPerDay)
      setPlanningDayMilesDraft(nextDayMiles)
      setPlanningReverseDraft(Boolean(selected.planReverseDirection ?? importedSources[selected.id]?.planReverseDirection))
    }
  }

  function closeActivityDrawerCompletely() {
    setActivityDrawerOpen(false)
    setActivityDrawerEditMode(false)
    setPlanningToolOpen(false)
    setLogContextMenu(null)
    setSelectedId(null)
    setFocusPlaceId(null)
    userSelectedPlaceRef.current = false
  }

  function adjustPlanningDayMiles(dayIndex, direction) {
    if (!planningDayMilesDraft.length) return
    if (!Number.isFinite(selectedRouteMiles) || selectedRouteMiles <= 0) return
    const current = planningDayMilesDraft[dayIndex]
    if (!Number.isFinite(current)) return

    const nextMiles = Math.max(0.5, current + direction)
    setPlanningDayMilesDraft((currentMiles) => rebalancePlanningDayMiles(currentMiles, dayIndex, nextMiles, selectedRouteMiles))
  }

  function resetPlanningDayMiles() {
    if (!Number.isFinite(selectedRouteMiles) || selectedRouteMiles <= 0) return
    const nextMilesPerDay = Number.isFinite(planningMilesPerDay) && planningMilesPerDay > 0 ? planningMilesPerDay : 10
    setPlanningDayMilesDraft(buildPlanningDayMilesList(selectedRouteMiles, nextMilesPerDay))
  }

  function savePlanningTools() {
    if (!selected || selected.phase !== 'future') return

    const nextMilesPerDay = planningMilesPerDay
    const nextPatch = {
      planMilesPerDay: Number.isFinite(nextMilesPerDay) && nextMilesPerDay > 0 ? nextMilesPerDay : null,
      planReverseDirection: planningReverseDirection,
      planDayBreakpoints: planningDayMilesDraft.length ? planningDayMilesDraft : null,
    }

    updateLogDetails(selected.id, nextPatch)
    const targetLabel = Number.isFinite(nextMilesPerDay) && nextMilesPerDay > 0 ? `${nextMilesPerDay.toFixed(1)} mi/day` : 'no target'
    const daysLabel = Number.isFinite(planningEstimatedDays) ? formatPlanningDays(planningEstimatedDays) : 'n/a'
    setImportStatus(`Plan saved. ${planningReverseDirection ? 'Reversed' : 'Forward'} · ${targetLabel} = ${daysLabel}.`)
    setPlanningToolOpen(false)
  }

  function beginFileManagerDrag(event) {
    if (event.button !== 0) return
    if (event.target.closest('button, input, select, label')) return

    if (fileManagerFullscreen) {
      setFileManagerFullscreen(false)
      fileManagerDragRef.current = {
        offsetX: 320,
        offsetY: 24,
      }
      setFileManagerPosition({
        x: Math.max(12, event.clientX - 320),
        y: Math.max(12, event.clientY - 24),
      })
      setFileManagerDragging(true)
      event.preventDefault()
      return
    }

    const windowNode = fileManagerWindowRef.current
    if (!windowNode) return

    const rect = windowNode.getBoundingClientRect()
    fileManagerDragRef.current = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    }
    setFileManagerDragging(true)
    event.preventDefault()
  }

  function toggleFileManagerFullscreen() {
    setFileManagerDragging(false)
    fileManagerDragRef.current = null
    setFileManagerFullscreen((current) => !current)
  }

  function openLogContextMenu(event, place = selected) {
    if (!place || place.kind === 'waypoint') return

    event.preventDefault()
    event.stopPropagation()

    const menuWidth = 210
    const menuHeight = 176
    const x = Math.min(event.clientX, Math.max(12, window.innerWidth - menuWidth - 12))
    const y = Math.min(event.clientY, Math.max(12, window.innerHeight - menuHeight - 12))

    setLogContextMenu({
      x,
      y,
      placeId: place.id,
    })
  }

  function openPlaceDetails(placeId) {
    if (!placeId) return
    userSelectedPlaceRef.current = true
    setSelectedId(placeId)
    setActivityDrawerOpen(true)
    setActivityDrawerEditMode(false)
    setPlanningToolOpen(false)
  }

  function handleSelectPlace(placeId) {
    if (!placeId) return
    userSelectedPlaceRef.current = true
    setSelectedId(placeId)
    setActivityDrawerOpen(true)
    setActivityDrawerEditMode(false)
    setPlanningToolOpen(false)
  }

  async function handleMapClick(point) {
    if ((toolMode !== 'measure' && toolMode !== 'draw' && toolMode !== 'elevation') || !point) return
    if (toolMode === 'draw' && suppressNextDrawClickRef.current) {
      suppressNextDrawClickRef.current = false
      return
    }

    const lng = Number(point.lng)
    const lat = Number(point.lat)
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return

    if (toolMode === 'measure') {
      setMeasurePoints((current) => {
        const next = [...current, { lng, lat }]
        setImportStatus(`Measure point ${next.length} added.`)
        return next
      })
      return
    }

    if (toolMode === 'elevation') {
      const map = mapInstanceRef.current
      const elevation = await querySpotElevationFeet(lng, lat, map)
      setElevationPoints((current) => {
        const next = [...current, { lng, lat, elevation: Number.isFinite(elevation) ? elevation : null }]
        setImportStatus(
          Number.isFinite(elevation)
            ? `Elevation point ${next.length} added at ${formatFeetValue(elevation)}.`
            : `Elevation point ${next.length} added.`,
        )
        return next
      })
      return
    }

    if (drawToolMode === 'adjust') {
      setImportStatus('Drag a point to move it.')
      return
    }

    if (drawToolMode === 'erase') {
      removeNearestDrawPoint({ lng, lat })
      return
    }

    setDrawPoints((current) => {
      const next = [...current, { lng, lat }]
      setDrawCurveControls((controls) => [...controls, null])
      setImportStatus(`Draw point ${next.length} added.`)
      return next
    })
  }

  function clearMeasureTool() {
    setMeasurePoints([])
    setImportStatus('Measure cleared.')
  }

  function clearElevationTool() {
    setElevationPoints([])
    setImportStatus('Elevation cleared.')
  }

  function clearDrawTool() {
    setDrawPoints([])
    setDrawCurveControls([])
    setImportStatus('Draw cleared.')
  }

  function exportDrawGeoJson() {
    if (!drawExportGeoJson) {
      setImportStatus('Nothing to export yet.')
      return
    }

    const blob = new Blob([JSON.stringify(drawExportGeoJson, null, 2)], { type: 'application/geo+json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    anchor.href = url
    anchor.download = `dfw-draw-${timestamp}.geojson`
    anchor.click()
    URL.revokeObjectURL(url)
    setImportStatus('Draw exported as GeoJSON.')
  }

  function removeDrawPointAtIndex(index) {
    setDrawPoints((current) => {
      if (!current.length || index < 0 || index >= current.length) return current

      const next = current.filter((_, pointIndex) => pointIndex !== index)
      setDrawCurveControls(Array.from({ length: Math.max(0, next.length - 1) }, () => null))
      setImportStatus('Removed a sketch point.')
      return next
    })
  }

  function removeNearestDrawPoint(lngLat) {
    if (!lngLat) return

    setDrawPoints((current) => {
      if (!current.length) {
        setImportStatus('Nothing to erase.')
        return current
      }

      let closestIndex = 0
      let closestDistance = Number.POSITIVE_INFINITY
      current.forEach((candidate, index) => {
        const distance = haversineMeters(lngLat, candidate)
        if (distance < closestDistance) {
          closestDistance = distance
          closestIndex = index
        }
      })

      if (closestDistance > 80) {
        setImportStatus('Click closer to a sketch point to remove it.')
        return current
      }

      const next = current.filter((_, index) => index !== closestIndex)
      setDrawCurveControls(Array.from({ length: Math.max(0, next.length - 1) }, () => null))
      setImportStatus('Removed a sketch point.')
      return next
    })
  }

  function suppressNextDrawMapClick() {
    suppressNextDrawClickRef.current = true
  }

  function setDrawSketchMode() {
    setDrawToolMode('sketch')
    setImportStatus('Draw sketch mode active.')
  }

  function setDrawAdjustMode() {
    setDrawToolMode('adjust')
    setImportStatus('Draw adjust mode active. Drag a point to move it.')
  }

  function setDrawEraseMode() {
    setDrawToolMode('erase')
    setImportStatus('Draw erase mode active. Click a point to remove it.')
  }

  function setElevationToolMode() {
    setToolMode('elevation')
    setOpenGroup('elevation')
    setImportStatus('Elevation tool active. Click the map to sample terrain.')
  }

  function setDrawStraightLineMode() {
    setDrawPathMode('straight')
    setImportStatus('Straight line mode active.')
  }

  function setDrawCurveLineMode() {
    setDrawPathMode('curve')
    setImportStatus('Curve line mode active.')
  }

  function toggleDrawPointsVisible() {
    setDrawPointsVisible((current) => {
      const next = !current
      setImportStatus(next ? 'Sketch points shown.' : 'Sketch points hidden.')
      return next
    })
  }

  function updateDrawCurveControl(index, lngLat) {
    setDrawCurveControls((current) => {
      const next = [...current]
      next[index] = lngLat
      return next
    })
  }

  function updateDrawPoint(index, lngLat) {
    setDrawPoints((current) => {
      const next = current.map((point, pointIndex) => (pointIndex === index ? { lng: lngLat.lng, lat: lngLat.lat } : point))
      return next
    })
    setImportStatus(`Moved draw point ${index + 1}.`)
  }

  function undoDrawPoint() {
    setDrawPoints((current) => current.slice(0, -1))
    setDrawCurveControls((current) => current.slice(0, -1))
    setImportStatus('Removed the last draw point.')
  }

  function clearScreenshotSelection() {
    setScreenshotDrag(null)
    setScreenshotRegion(null)
  }

  function drawProjectedLine(context, map, geoJson, color, lineWidth, dash = []) {
    const coordinates = geoJson?.geometry?.coordinates
    if (!map || !Array.isArray(coordinates) || coordinates.length < 2) return

    context.save()
    context.beginPath()
    context.strokeStyle = color
    context.lineWidth = lineWidth
    context.lineJoin = 'round'
    context.lineCap = 'round'
    if (dash.length) {
      context.setLineDash(dash)
    }

    coordinates.forEach((coordinate, index) => {
      if (!Array.isArray(coordinate) || coordinate.length < 2) return
      const point = map.project([coordinate[0], coordinate[1]])
      if (!point) return
      if (index === 0) {
        context.moveTo(point.x, point.y)
      } else {
        context.lineTo(point.x, point.y)
      }
    })

    context.stroke()
    context.restore()
  }

  function waitForAnimationFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()))
  }

  function handleMapReady(map) {
    mapInstanceRef.current = map || null
  }

  function startScreenshotSelection(event) {
    if (!screenshotOpen || event.button !== 0) return
    const stage = screenshotStageRef.current
    if (!stage) return

    event.preventDefault()

    const rect = stage.getBoundingClientRect()
    const x = clamp(event.clientX - rect.left, 0, rect.width)
    const y = clamp(event.clientY - rect.top, 0, rect.height)

    setScreenshotDrag({
      startX: x,
      startY: y,
      endX: x,
      endY: y,
    })
    setScreenshotRegion(null)
  }

  function updateScreenshotSelection(event) {
    if (!screenshotDrag) return
    event.preventDefault()

    const stage = screenshotStageRef.current
    if (!stage) return

    const rect = stage.getBoundingClientRect()
    const endX = clamp(event.clientX - rect.left, 0, rect.width)
    const endY = clamp(event.clientY - rect.top, 0, rect.height)

    setScreenshotDrag((current) => (current ? { ...current, endX, endY } : current))
  }

  function finishScreenshotSelection() {
    if (!screenshotDrag) return

    const width = Math.abs(screenshotDrag.endX - screenshotDrag.startX)
    const height = Math.abs(screenshotDrag.endY - screenshotDrag.startY)
    if (width < 8 || height < 8) {
      clearScreenshotSelection()
      setImportStatus('Drag a larger rectangle to select an area.')
      return
    }

    const left = Math.min(screenshotDrag.startX, screenshotDrag.endX)
    const top = Math.min(screenshotDrag.startY, screenshotDrag.endY)

    setScreenshotRegion({ left, top, width, height })
    setScreenshotDrag(null)
    setImportStatus('Screenshot area selected.')
  }

  async function captureMapScreenshot(region = screenshotRegion) {
    const target = document.querySelector('.map-canvas')
    const map = mapInstanceRef.current
    if (!target) {
      setImportStatus('Screenshot tool is waiting for the map to load.')
      return
    }

    if (!region) {
      setImportStatus('Draw a rectangle first.')
      return
    }

    try {
      map?.triggerRepaint?.()
      await waitForAnimationFrame()
      await waitForAnimationFrame()

      const stage = screenshotStageRef.current
      const stageRect = stage?.getBoundingClientRect?.() || target.getBoundingClientRect()
      const pixelRatio = window.devicePixelRatio || 1
      const exportCanvas = document.createElement('canvas')
      exportCanvas.width = Math.max(1, Math.round(stageRect.width * pixelRatio))
      exportCanvas.height = Math.max(1, Math.round(stageRect.height * pixelRatio))

      const context = exportCanvas.getContext('2d')
      if (!context) {
        throw new Error('Could not prepare the screenshot canvas.')
      }

      const sourceCanvas = map?.getCanvas?.()
      if (!sourceCanvas) {
        throw new Error('Could not find the live map canvas.')
      }
      context.drawImage(sourceCanvas, 0, 0, exportCanvas.width, exportCanvas.height)

      drawProjectedLine(context, map, selectedRouteGeoJson, selectedRouteColor || '#4f8cff', 4 * pixelRatio)
      drawProjectedLine(context, map, measureLineGeoJson, '#f2b25c', 3 * pixelRatio, [2 * pixelRatio, 1 * pixelRatio])
      drawProjectedLine(context, map, elevationLineGeoJson, '#9cdbff', 3 * pixelRatio)
      drawProjectedLine(context, map, drawLineGeoJson, '#7ad3ff', 3 * pixelRatio)

      if (screenshotIncludeLogs) {
        const overlay = await html2canvas(target, {
          backgroundColor: null,
          useCORS: true,
          scale: pixelRatio,
          logging: false,
          ignoreElements: (element) =>
            Boolean(
              element?.classList?.contains('screenshot-stage') ||
                element?.classList?.contains('file-manager-modal') ||
                element?.classList?.contains('log-context-menu-backdrop') ||
                element?.classList?.contains('log-context-menu') ||
                element?.classList?.contains('activity-drawer') ||
                element?.tagName === 'CANVAS' ||
                element?.classList?.contains('mapboxgl-canvas'),
            ),
        })

        context.drawImage(overlay, 0, 0, exportCanvas.width, exportCanvas.height)
      }

      const scaleX = exportCanvas.width / stageRect.width
      const scaleY = exportCanvas.height / stageRect.height
      const sourceX = clamp(region.left * scaleX, 0, exportCanvas.width)
      const sourceY = clamp(region.top * scaleY, 0, exportCanvas.height)
      const sourceWidth = clamp(region.width * scaleX, 1, exportCanvas.width - sourceX)
      const sourceHeight = clamp(region.height * scaleY, 1, exportCanvas.height - sourceY)
      const finalCanvas = document.createElement('canvas')
      finalCanvas.width = Math.max(1, Math.round(sourceWidth))
      finalCanvas.height = Math.max(1, Math.round(sourceHeight))

      const finalContext = finalCanvas.getContext('2d')
      if (!finalContext) {
        throw new Error('Could not prepare the screenshot output.')
      }

      finalContext.drawImage(
        exportCanvas,
        Math.max(0, sourceX),
        Math.max(0, sourceY),
        Math.max(1, Math.round(sourceWidth)),
        Math.max(1, Math.round(sourceHeight)),
        0,
        0,
        finalCanvas.width,
        finalCanvas.height,
      )

      const blob = await new Promise((resolve, reject) => {
        finalCanvas.toBlob((nextBlob) => {
          if (nextBlob) resolve(nextBlob)
          else reject(new Error('Could not capture the selected area.'))
        }, 'image/png')
      })

      const fileName = `dfw-map-selection-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
      const url = URL.createObjectURL(blob)

      setScreenshotPreview((current) => {
        if (current?.url) URL.revokeObjectURL(current.url)
        return { url, blob, fileName }
      })
      setImportStatus('Screenshot captured. Review it in the preview.')
      clearScreenshotSelection()
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : 'Could not capture the screenshot.')
    }
  }

  async function shareCapturedScreenshot() {
    const preview = screenshotPreview
    if (!preview) return

    try {
      const file = new File([preview.blob], preview.fileName, { type: preview.blob.type || 'image/png' })
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({
          files: [file],
          title: 'Map screenshot',
          text: 'Captured from DFW-app',
        })
        setImportStatus('Screenshot shared.')
        return
      }

      const anchor = document.createElement('a')
      anchor.href = preview.url
      anchor.download = preview.fileName
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      setImportStatus('Sharing not available here, so the screenshot was downloaded instead.')
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : 'Could not share the screenshot.')
    }
  }

  function saveCapturedScreenshot() {
    const preview = screenshotPreview
    if (!preview) return

    const anchor = document.createElement('a')
    anchor.href = preview.url
    anchor.download = preview.fileName
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setImportStatus('Screenshot downloaded.')
  }

  function closeLogContextMenu() {
    setLogContextMenu(null)
  }

  async function deleteLogPlace(placeId) {
    if (!placeId) return

    const target = places.find((place) => place.id === placeId)
    if (!target) return

    const remainingPlaces = places.filter((place) => place.id !== placeId)
    const nextSelected = remainingPlaces.find((place) => place.phase === (target.phase || 'past')) || remainingPlaces[0] || null
    const hasImportedSource = Boolean(importedSources[placeId])
    const mediaMatches = placeMediaEntries.filter((entry) => entry.placeId === placeId)

    closeLogContextMenu()
    setActivityDrawerOpen(false)
    setActivityDrawerEditMode(false)
    setFocusPlaceId((current) => (current === placeId ? null : current))

    mediaMatches.forEach((entry) => {
      if (entry.url) URL.revokeObjectURL(entry.url)
    })
    setPlaceMediaEntries((current) => current.filter((entry) => entry.placeId !== placeId))

    setPlaces((current) => current.filter((place) => place.id !== placeId))

    if (selectedId === placeId || (selectedId && !remainingPlaces.some((place) => place.id === selectedId))) {
      setSelectedId(nextSelected?.id ?? null)
    }

    if (mediaUploadTargetId === placeId) {
      setMediaUploadTargetId(null)
    }

    try {
      if (mediaMatches.length) {
        await deletePlaceMediaForPlace(placeId)
      }
    } catch {
      // Keep the UI responsive if IndexedDB cleanup fails.
    }

    if (hasImportedSource) {
      setImportedSources((current) => {
        const next = { ...current }
        delete next[placeId]
        return next
      })

      try {
        await deleteImportedSource(placeId)
      } catch {
        // Keep the UI responsive if IndexedDB cleanup fails.
      }
    }
  }

  function openMediaUploadForPlace(placeId) {
    if (!placeId) return

    setMediaUploadTargetId(placeId)
    closeLogContextMenu()
    if (mediaUploadInputRef.current) {
      mediaUploadInputRef.current.click()
    }
  }

  async function handleSelectedMediaUpload(event) {
    const files = Array.from(event.target.files || []).filter((file) => file.type.startsWith('image/') || file.type.startsWith('video/'))
    const targetPlace = places.find((place) => place.id === mediaUploadTargetId) || selected

    if (!files.length || !targetPlace) {
      event.target.value = ''
      return
    }

    const targetId = targetPlace.id
    const records = files.map((file) => ({
      id: crypto.randomUUID(),
      placeId: targetId,
      kind: file.type.startsWith('video/') ? 'video' : 'image',
      name: file.name,
      mimeType: file.type,
      blob: file,
      createdAt: new Date().toISOString(),
      url: URL.createObjectURL(file),
    }))

    setPlaceMediaEntries((current) => [...current, ...records])

    try {
      await Promise.all(records.map((record) => savePlaceMedia(record)))
      setImportStatus(records.length === 1 ? `Added ${records[0].name} to ${targetPlace.name}.` : `Added ${records.length} media items to ${targetPlace.name}.`)
    } catch {
      setImportStatus('Could not save that media.')
    } finally {
      event.target.value = ''
      setMediaUploadTargetId(null)
    }
  }

  async function deleteSelectedMedia(mediaId) {
    const target = placeMediaEntries.find((entry) => entry.id === mediaId)
    if (!target) return

    if (target.url) {
      URL.revokeObjectURL(target.url)
    }

    setPlaceMediaEntries((current) => current.filter((entry) => entry.id !== mediaId))

    try {
      await deletePlaceMedia(mediaId)
    } catch {
      // Keep the UI responsive even if IndexedDB deletion fails.
    }
  }

  function getFolderLabel(folderId) {
    if (!folderId || folderId === 'inbox') return 'Inbox'
    return fileFolders.find((folder) => folder.id === folderId)?.name || 'Inbox'
  }

  function deleteSelectedImportedFile() {
    if (!fileBrowserSelectionId) return
    deleteImportedFile(fileBrowserSelectionId)
    setFileBrowserSelectionId((current) => (current === fileBrowserSelectionId ? null : current))
  }

  async function openImportedFile(placeId) {
    const target = places.find((place) => place.id === placeId)
    if (target) {
      setSelectedId(placeId)
      setActiveLayer(target.phase || 'past')
      setFocusPlaceId(placeId)
      setFileManagerOpen(false)
      return
    }

    const source = importedSources[placeId]
    if (!source) return

    try {
      const fileName = source.sourceName || `${placeId}.${source.sourceFormat || 'fit'}`
      const fileType = source.sourceMime || 'application/octet-stream'
      const file = source.sourceBytes
        ? new File([source.sourceBytes], fileName, { type: fileType })
        : new File([source.sourceText || ''], fileName, { type: fileType })
      const imported = await importRunFile(file)
      const { sourceText, sourceBytes, sourceFormat, sourceMime, ...run } = imported
      const reopenedRun = { ...run, id: placeId }

      setPlaces((current) => [reopenedRun, ...current.filter((place) => place.id !== placeId)])
      setImportedSources((current) => ({
        ...current,
        [placeId]: {
          sourceText: sourceText ?? '',
          sourceBytes: sourceBytes ?? null,
          sourceFormat,
          sourceMime,
          sourceName: fileName,
          displayName: source?.displayName || fileName,
          folderId: source?.folderId || 'inbox',
          routeColor: source?.routeColor || DEFAULT_ROUTE_COLOR,
          updatedAt: new Date().toISOString(),
        },
      }))
      setSelectedId(placeId)
      setActiveLayer(reopenedRun.phase || 'past')
      setFocusPlaceId(placeId)
      setFileManagerOpen(false)
      setImportStatus(`Opened ${reopenedRun.name} from saved files.`)
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : 'Could not reopen that file.')
      return
    }
  }

  async function deleteImportedFile(placeId) {
    const target = importedSources[placeId]
    if (!target) return

    setImportedSources((current) => {
      const next = { ...current }
      delete next[placeId]
      return next
    })

    try {
      await deleteImportedSource(placeId)
    } catch {
      // Leave the UI state responsive even if IndexedDB deletion fails.
    }

    if (selectedId === placeId) {
      const nextSelected = places.find((place) => place.id !== placeId) ?? null
      setSelectedId(nextSelected?.id ?? null)
    }
  }

  async function deleteAllImportedFiles() {
    const importedIds = Object.keys(importedSources)
    if (!importedIds.length) {
      setImportStatus('No imported files to delete.')
      return
    }

    const confirmed = window.confirm(`Delete all ${importedIds.length} imported files? This will remove them from the map.`)
    if (!confirmed) return

    const importedIdSet = new Set(importedIds)
    const mediaMatches = placeMediaEntries.filter((entry) => importedIdSet.has(entry.placeId))

    mediaMatches.forEach((entry) => {
      if (entry.url) URL.revokeObjectURL(entry.url)
    })

    setPlaceMediaEntries((current) => current.filter((entry) => !importedIdSet.has(entry.placeId)))
    setImportedSources((current) => {
      const next = { ...current }
      importedIds.forEach((id) => {
        delete next[id]
      })
      return next
    })
    setPlaces((current) => current.filter((place) => !importedIdSet.has(place.id)))

    if (selectedId && importedIdSet.has(selectedId)) {
      setSelectedId(null)
    }
    if (focusPlaceId && importedIdSet.has(focusPlaceId)) {
      setFocusPlaceId(null)
    }
    if (mediaUploadTargetId && importedIdSet.has(mediaUploadTargetId)) {
      setMediaUploadTargetId(null)
    }

    setActivityDrawerOpen(false)
    setActivityDrawerEditMode(false)
    setPlanningToolOpen(false)
    setLogContextMenu(null)
    setFileBrowserSelectionId(null)

    try {
      await Promise.allSettled(importedIds.map((id) => deleteImportedSource(id)))
    } catch {
      // Keep the UI responsive even if IndexedDB cleanup fails.
    }

    setImportStatus(`Deleted ${importedIds.length} imported file${importedIds.length === 1 ? '' : 's'}.`)
  }

  return (
    <div className="app-shell">
      <main className="map-stage">
        <LifeMap
          mapboxToken={MAPBOX_TOKEN}
          visiblePlaces={visiblePlaces}
          selected={selected}
          selectedRouteGeoJson={selectedRouteGeoJson}
          selectedRouteColor={selectedRouteColor}
          plannedRouteMarkers={plannedRouteMarkers}
          showPlannedRouteMarkers={planningMarkersVisible}
          measureLineGeoJson={measureLineGeoJson}
          elevationLineGeoJson={elevationLineGeoJson}
          elevationPointsGeoJson={elevationPointsGeoJson}
          drawLineGeoJson={drawDisplayGeoJson}
          drawPointsGeoJson={drawPointsGeoJson}
          drawCurveControlPoints={drawCurveControlPoints}
          drawPointsVisible={drawPointsVisible}
          drawPathMode={drawPathMode}
          drawToolMode={drawToolMode}
          activeTool={toolMode}
          screenshotOpen={screenshotOpen}
          onSelectPlace={handleSelectPlace}
          onOpenPlaceDetails={openPlaceDetails}
          onTerrainProfileChange={setSelectedRouteTerrainProfile}
          querySpotElevationFeet={querySpotElevationFeet}
          onContextMenuPlace={(place, event) => {
            setSelectedId(place.id)
            setActiveLayer(place.phase || activeLayer)
            openLogContextMenu(event, place)
          }}
          onMapClick={handleMapClick}
          onMove={setMapViewState}
          initialViewState={mapViewState}
          focusPlaceId={focusPlaceId}
          onMapReady={handleMapReady}
          onUpdateDrawCurveControl={updateDrawCurveControl}
          onUpdateDrawPoint={updateDrawPoint}
          onRemoveDrawPoint={removeDrawPointAtIndex}
          onSuppressNextDrawMapClick={suppressNextDrawMapClick}
        />

        {(toolMode === 'measure' || toolMode === 'draw' || toolMode === 'elevation') && (
          <div
            className={toolMode === 'draw' ? 'tool-header tool-header--draw' : toolMode === 'elevation' ? 'tool-header tool-header--measure' : 'tool-header tool-header--measure'}
            role="region"
            aria-label={toolMode === 'draw' ? 'Draw tool' : toolMode === 'elevation' ? 'Elevation tool' : 'Measure tool'}
          >
            <div className="tool-header__top">
              <div className="tool-header__title">
                {toolMode === 'draw' ? <PenLine size={16} /> : toolMode === 'elevation' ? <Mountain size={16} /> : <Wrench size={16} />}
                <div>
                  <strong>{toolMode === 'draw' ? 'Draw' : toolMode === 'elevation' ? 'Elevation' : 'Measure'}</strong>
                  <span>{toolMode === 'draw' ? drawSummaryText : toolMode === 'elevation' ? elevationSummary : measureSummaryText}</span>
                </div>
              </div>
              <div className="tool-header__status">
                {toolMode === 'draw'
                  ? drawModeLabel
                  : toolMode === 'elevation'
                    ? elevationStats
                      ? `${elevationStats.count} pts`
                      : '0 pts'
                    : measureDistanceMeters
                      ? `${formatFeet(measureDistanceMeters)} / ${(measureDistanceMeters / 1609.344).toFixed(2)} mi`
                      : '0 ft'}
              </div>
            </div>
            <div className="tool-header__body">
              <div className="tool-header__stats" aria-label={toolMode === 'draw' ? 'Draw statistics' : toolMode === 'elevation' ? 'Elevation calculations' : 'Measure calculations'}>
                {toolMode === 'draw' ? (
                  <>
                    <div className="tool-header__stat">
                      <span>Sketch points</span>
                      <strong>{drawPoints.length}</strong>
                    </div>
                    <div className="tool-header__stat">
                      <span>Mode</span>
                      <strong>{drawModeLabel}</strong>
                    </div>
                  </>
                ) : toolMode === 'elevation' ? (
                  <>
                    <div className="tool-header__stat">
                      <span>Points</span>
                      <strong>{elevationStats?.count || 0}</strong>
                    </div>
                    <div className="tool-header__stat">
                      <span>Gain / loss</span>
                      <strong>{elevationStats ? `${formatFeetValue(elevationStats.gain)} / ${formatFeetValue(elevationStats.loss)}` : '0 ft / 0 ft'}</strong>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="tool-header__stat">
                      <span>Points</span>
                      <strong>{measurePoints.length}</strong>
                    </div>
                    <div className="tool-header__stat">
                      <span>Distance</span>
                      <strong>{measureDistanceMeters ? `${formatFeet(measureDistanceMeters)} / ${(measureDistanceMeters / 1609.344).toFixed(2)} mi` : '0 ft'}</strong>
                    </div>
                  </>
                )}
              </div>
              <div className="tool-header__sections">
                {toolMode === 'draw' ? (
                  <>
                    <div className="tool-header__section">
                      <span className="tool-header__kicker">Mode</span>
                      <div className="tool-header__actions">
                        <button className={drawToolMode === 'sketch' ? 'tool-chip tool-chip--active' : 'tool-chip'} style={hudTone('quick')} onClick={setDrawSketchMode}>
                          <span>Sketch</span>
                        </button>
                        <button className={drawToolMode === 'adjust' ? 'tool-chip tool-chip--active' : 'tool-chip'} style={hudTone('quick')} onClick={setDrawAdjustMode}>
                          <span>Adjust points</span>
                        </button>
                        <button className={drawToolMode === 'erase' ? 'tool-chip tool-chip--active' : 'tool-chip'} style={hudTone('quick')} onClick={setDrawEraseMode}>
                          <span>Erase point</span>
                        </button>
                      </div>
                    </div>
                    <div className="tool-header__section">
                      <span className="tool-header__kicker">Path</span>
                      <div className="tool-header__actions">
                        <button className={drawPathMode === 'straight' ? 'tool-chip tool-chip--active' : 'tool-chip'} style={hudTone('quick')} onClick={setDrawStraightLineMode}>
                          <span>Straight line</span>
                        </button>
                        <button className={drawPathMode === 'curve' ? 'tool-chip tool-chip--active' : 'tool-chip'} style={hudTone('quick')} onClick={setDrawCurveLineMode}>
                          <span>Curve line</span>
                        </button>
                        <button className={drawPointsVisible ? 'tool-chip tool-chip--active' : 'tool-chip'} style={hudTone('quick')} onClick={toggleDrawPointsVisible}>
                          <span>{drawPointsToggleLabel}</span>
                        </button>
                        <button className="tool-chip" style={hudTone('quick')} disabled>
                          <span>{drawCurveRadiusLabel}</span>
                        </button>
                      </div>
                    </div>
                    <div className="tool-header__section">
                      <span className="tool-header__kicker">Edit</span>
                      <div className="tool-header__actions">
                        <button className="tool-chip" style={hudTone('quick')} onClick={undoDrawPoint} disabled={!drawPoints.length}>
                          <span>Undo</span>
                        </button>
                        <button className="tool-chip" style={hudTone('quick')} onClick={exportDrawGeoJson} disabled={!drawExportGeoJson}>
                          <span>Export GeoJSON</span>
                        </button>
                        <button className="tool-chip" style={hudTone('quick')} onClick={clearDrawTool} disabled={!drawPoints.length}>
                          <span>Clear</span>
                        </button>
                      </div>
                    </div>
                  </>
                ) : toolMode === 'elevation' ? (
                  <div className="tool-header__section">
                    <span className="tool-header__kicker">Elevation</span>
                    <div className="tool-header__actions">
                      <button className="tool-chip" style={hudTone('quick')} onClick={clearElevationTool} disabled={!elevationPoints.length}>
                        <span>Clear</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="tool-header__section">
                    <span className="tool-header__kicker">Measure</span>
                    <div className="tool-header__actions">
                      <button className="tool-chip" style={hudTone('quick')} onClick={clearMeasureTool} disabled={!measurePoints.length}>
                        <span>Clear</span>
                      </button>
                    </div>
                  </div>
                )}
                <button
                  className="tool-chip tool-chip--close"
                  style={hudTone('quick')}
                  onClick={() => {
                    setToolMode('none')
                    setOpenGroup(null)
                    setImportStatus(toolMode === 'draw' ? 'Draw mode closed.' : 'Measure mode closed.')
                  }}
                >
                  <span>Close tool</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {screenshotOpen && (
          <div
            ref={screenshotStageRef}
            className={screenshotDrag ? 'screenshot-stage active' : 'screenshot-stage'}
            role="presentation"
            onPointerDown={startScreenshotSelection}
            onPointerMove={updateScreenshotSelection}
            onPointerUp={finishScreenshotSelection}
            onPointerLeave={finishScreenshotSelection}
          >
            {screenshotSelectionBox && (
              <div
                className="screenshot-selection"
                style={{
                  left: `${screenshotSelectionBox.left}px`,
                  top: `${screenshotSelectionBox.top}px`,
                  width: `${screenshotSelectionBox.width}px`,
                  height: `${screenshotSelectionBox.height}px`,
                }}
              >
                <span>
                  {Math.round(screenshotSelectionBox.width)} x {Math.round(screenshotSelectionBox.height)}
                </span>
              </div>
            )}
          </div>
        )}

        <div className="map-overlay">
          {activeLayer === 'past' && logbookView === 'chronological' && (
            <div className="logbook-chronology-panel">
              <div className="logbook-chronology-panel__head">
                <span>Logbook chronology</span>
                <small>
                  {Number.isFinite(logbookChronologicalYear)
                    ? `${logbookChronologicalYear}${Number.isFinite(logbookChronologicalMonth) ? ` · ${LOGBOOK_MONTH_LABELS[logbookChronologicalMonth]}` : ''}`
                    : 'Pick a year'}
                </small>
                <button
                  className="hud-subpill logbook-chronology-panel__exit"
                  style={hudTone('layers')}
                  onClick={() => {
                    setLogbookChronologicalYear(null)
                    setLogbookChronologicalMonth(null)
                    setLogbookView('activity')
                  }}
                >
                  <span>Exit</span>
                </button>
              </div>
              <div className="logbook-chronology-panel__row">
                {logbookChronologyYears.length ? (
                  logbookChronologyYears.map((year) => (
                    <button
                      key={year}
                      className={logbookChronologicalYear === year ? 'hud-subpill active' : 'hud-subpill'}
                      style={hudTone('layers', logbookChronologicalYear === year)}
                      onClick={() => {
                        setLogbookChronologicalYear(year)
                        setLogbookChronologicalMonth(null)
                      }}
                    >
                      <span>{year}</span>
                    </button>
                  ))
                ) : (
                  <button className="hud-subpill" style={hudTone('layers')} disabled>
                    <span>No logbook years yet</span>
                  </button>
                )}
              </div>
              <div className="logbook-chronology-panel__row logbook-chronology-panel__row--months">
                {Number.isFinite(logbookChronologicalYear) && logbookChronologyMonths.length ? (
                  logbookChronologyMonths.map((month) => (
                    <button
                      key={month}
                      className={logbookChronologicalMonth === month ? 'hud-subpill active' : 'hud-subpill'}
                      style={hudTone('layers', logbookChronologicalMonth === month)}
                      onClick={() => setLogbookChronologicalMonth(month)}
                    >
                      <span>{LOGBOOK_MONTH_LABELS[month]}</span>
                    </button>
                  ))
                ) : (
                  <button className="hud-subpill" style={hudTone('layers')} disabled>
                    <span>Pick a year to see months</span>
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="button-stack">
            <button
              className="hud-main-pill"
              style={hudTone('layers', openGroup === 'layers')}
              onClick={() => setOpenGroup((current) => (current === 'layers' ? null : 'layers'))}
            >
              <Compass size={14} />
              <span>Layers</span>
            </button>
            {openGroup === 'layers' && (
              <div className="layer-panel">
                <div className="hud-substack">
                  {layers.map((layer) => {
                    const Icon = layer.icon
                    return (
                      <button
                        key={layer.id}
                        className={layer.id === activeLayer ? 'hud-subpill active' : 'hud-subpill'}
                        style={hudTone('layers', layer.id === activeLayer)}
                        onClick={() => setActiveLayer(layer.id)}
                      >
                        <Icon size={14} />
                        <span>{layer.label}</span>
                      </button>
                    )
                  })}
                </div>

                {activeLayer === 'past' && (
                  <div className="hud-flyout hud-flyout--right">
                    <button
                      className={logbookView === 'chronological' ? 'hud-subpill active' : 'hud-subpill'}
                      style={hudTone('layers', logbookView === 'chronological')}
                      onClick={() => setLogbookView('chronological')}
                    >
                      <span>Chronological</span>
                    </button>
                    <button
                      className={logbookView === 'activity' ? 'hud-subpill active' : 'hud-subpill'}
                      style={hudTone('layers', logbookView === 'activity')}
                      onClick={() => setLogbookView('activity')}
                    >
                      <Activity size={14} />
                      <span>By activity</span>
                    </button>
                    {logbookView === 'activity' && (
                      <div className="hud-activity-grid">
                        {LOGBOOK_ACTIVITY_FILTERS.map((activity) => (
                          <button
                            key={activity.id}
                            className={logbookActivityFilter === activity.id ? 'hud-subpill active' : 'hud-subpill'}
                            style={hudTone('layers', logbookActivityFilter === activity.id)}
                            onClick={() => setLogbookActivityFilter(activity.id)}
                          >
                            <span>{activity.label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <button
              className="hud-main-pill"
              style={hudTone('import', openGroup === 'import')}
              onClick={() => setOpenGroup((current) => (current === 'import' ? null : 'import'))}
            >
              <Upload size={14} />
              <span>Import</span>
            </button>
            {openGroup === 'import' && (
              <div className="hud-substack">
                <label className="hud-subpill upload-button" style={hudTone('import')}>
                  <span>Load files</span>
                  <input type="file" accept=".gpx,.tcx,.geojson,.json,.fit" multiple onChange={handleImport} hidden />
                </label>
                <label className="hud-subpill upload-button" style={hudTone('import')}>
                  <span>Load folder</span>
                  <input type="file" accept=".gpx,.tcx,.geojson,.json,.fit" multiple webkitdirectory="" onChange={handleImport} hidden />
                </label>
                {importedSource ? (
                  <button className="hud-subpill" style={hudTone('import')} onClick={saveImportedFile}>
                    <span>Save imported file</span>
                  </button>
                ) : (
                  <button className="hud-subpill" style={hudTone('import')} disabled>
                    <span>Save imported file</span>
                  </button>
                )}
                {!!importStatus && (
                  <button className="hud-subpill" style={hudTone('import')} onClick={() => setImportStatus('')}>
                    <span>{importStatus}</span>
                  </button>
                )}
              </div>
            )}

            <button
              className="hud-main-pill"
              style={hudTone('quick', openGroup === 'tools')}
              onClick={() => setOpenGroup((current) => (current === 'tools' ? null : 'tools'))}
            >
              <Wrench size={14} />
              <span>{toolMode === 'measure' ? 'Tools: Measure' : toolMode === 'draw' ? 'Tools: Draw' : toolMode === 'elevation' ? 'Tools: Elevation' : 'Tools'}</span>
            </button>
            {openGroup === 'tools' && (
              <div className="layer-panel">
                <div className="hud-flyout hud-flyout--right hud-tools-flyout">
                  <button
                    className="hud-subpill"
                    style={hudTone('quick', toolMode === 'measure')}
                    onClick={() => {
                      setToolMode((current) => (current === 'measure' ? 'none' : 'measure'))
                      setOpenGroup(null)
                      setImportStatus(toolMode === 'measure' ? 'Measure mode off.' : 'Measure mode active. Click the map to add points.')
                    }}
                  >
                    <span>Measure</span>
                  </button>
                  <button
                    className="hud-subpill"
                    style={hudTone('quick', toolMode === 'draw')}
                    onClick={() => {
                      setToolMode('draw')
                      setDrawSketchMode()
                      setOpenGroup(null)
                      setImportStatus('Draw mode active. Use the map to sketch routes or shapes in the next step.')
                    }}
                  >
                    <span>Draw</span>
                  </button>
                  <button
                    className="hud-subpill"
                    style={hudTone('quick', toolMode === 'elevation')}
                    onClick={() => {
                      setElevationToolMode()
                      setOpenGroup('elevation')
                    }}
                  >
                    <span>Measure elevation</span>
                  </button>
                  <button className="hud-subpill" style={hudTone('quick')} onClick={() => setOpenGroup((current) => (current === 'tools' ? null : 'tools'))}>
                    <span>Close tools</span>
                  </button>
                </div>
              </div>
            )}

            <button
              className="hud-main-pill"
              style={hudTone('import', fileManagerOpen)}
              onClick={() => setFileManagerOpen((current) => !current)}
            >
              <NotebookPen size={14} />
              <span>Files</span>
            </button>
            {showLegacyLogbookList && activeLayer === 'past' && !fileManagerOpen && (
              <div className="hud-substack">
                {activeLayer === 'past' && (
                  <div className="hud-substack compact">
                    <button className="hud-subpill" style={hudTone('import')} disabled>
                      <span>
                        {logbookView === 'activity'
                          ? `Logbook by activity${logbookActivityFilter !== 'all' ? ` · ${titleCase(logbookActivityFilter)}` : ''}`
                          : `Logbook chronologically · ${logbookChronologicalMode === 'month' ? 'Month' : 'Year'}`}
                      </span>
                    </button>
                    {logbookEntries.length ? (
                      logbookView === 'chronological' ? (
                        logbookChronologyGroups.map((group) => (
                          <div key={group.id} className="logbook-group">
                            <div className="logbook-group__head">
                              <strong>{group.label}</strong>
                              <small>
                                {logbookChronologicalMode === 'month' ? `${group.monthGroups.length} month${group.monthGroups.length === 1 ? '' : 's'}` : `${group.entries.length} item${group.entries.length === 1 ? '' : 's'}`}
                              </small>
                            </div>
                            {logbookChronologicalMode === 'month' ? (
                              group.monthGroups.map((monthGroup) => (
                                <div key={monthGroup.id} className="logbook-month-group">
                                  <div className="logbook-month-group__head">
                                    <span>{monthGroup.label}</span>
                                    <small>{monthGroup.entries.length} item{monthGroup.entries.length === 1 ? '' : 's'}</small>
                                  </div>
                                  <div className="logbook-group__items">
                                    {monthGroup.entries.map((entry) => (
                                      <div key={entry.id} className="file-manager-item" style={hudTone('import')}>
                                        <button className="file-manager-main" onClick={() => openImportedFile(entry.id)}>
                                          <span>{entry.name}</span>
                                          <small>{entry.kind === 'run' ? (entry.activityLabel || titleCase(entry.activityType || 'run')) : 'Place'}</small>
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="logbook-group__items">
                                {group.entries.map((entry) => (
                                  <div key={entry.id} className="file-manager-item" style={hudTone('import')}>
                                    <button className="file-manager-main" onClick={() => openImportedFile(entry.id)}>
                                      <span>{entry.name}</span>
                                      <small>{entry.kind === 'run' ? (entry.activityLabel || titleCase(entry.activityType || 'run')) : 'Place'}</small>
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))
                      ) : (
                        logbookEntries.map((entry) => (
                          <div key={entry.id} className="file-manager-item" style={hudTone('import')}>
                            <button className="file-manager-main" onClick={() => openImportedFile(entry.id)}>
                              <span>{entry.name}</span>
                              <small>{entry.kind === 'run' ? (entry.activityLabel || titleCase(entry.activityType || 'run')) : 'Place'}</small>
                            </button>
                          </div>
                        ))
                      )
                    ) : (
                      <button className="hud-subpill" style={hudTone('import')} disabled>
                        <span>No logbook entries yet</span>
                      </button>
                    )}
                  </div>
                )}
                {importedFileEntries.length ? (
                  importedFileEntries.map((entry) => (
                    <div key={entry.id} className="file-manager-item" style={hudTone('import')}>
                      <button className="file-manager-main" onClick={() => openImportedFile(entry.id)}>
                        <span>{entry.sourceName}</span>
                        <small>{entry.place?.name || 'Imported file'}</small>
                      </button>
                      <div className="file-manager-actions">
                        <button className="hud-subpill file-manager-action" style={hudTone('import')} onClick={() => openImportedFile(entry.id)}>
                          <span>Open</span>
                        </button>
                        <button className="hud-subpill file-manager-action" style={hudTone('import')} onClick={() => saveImportedEntry(entry.id)}>
                          <span>Save</span>
                        </button>
                        <button className="hud-subpill file-manager-action" style={hudTone('import')} onClick={() => deleteImportedFile(entry.id)}>
                          <span>Delete</span>
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <button className="hud-subpill" style={hudTone('import')} disabled>
                    <span>No saved files yet</span>
                  </button>
                )}
              </div>
            )}

            {selected?.phase === 'future' && elevationProfileGraph && (
              <div className="hud-elevation-card" aria-label="Planning elevation profile">
                <div className="hud-elevation-card__head">
                  <span>Elevation profile</span>
                  <small>
                    {Number.isFinite(selectedRouteElevationGain)
                      ? `${Math.round(selectedRouteElevationGain)} ft gain`
                      : 'Calculating...'}
                  </small>
                </div>
                <svg
                  className="hud-elevation-chart"
                  viewBox={`0 0 ${elevationProfileGraph.width} ${elevationProfileGraph.height}`}
                  role="img"
                  aria-label="Elevation profile graph"
                  preserveAspectRatio="none"
                >
                  <line className="hud-elevation-axis" x1={elevationProfileGraph.leftPad} y1={elevationProfileGraph.topPad} x2={elevationProfileGraph.leftPad} y2={elevationProfileGraph.bottomPad} />
                  <line className="hud-elevation-axis" x1={elevationProfileGraph.leftPad} y1={elevationProfileGraph.bottomPad} x2={elevationProfileGraph.rightPad} y2={elevationProfileGraph.bottomPad} />
                  <polyline className="hud-elevation-line" points={elevationProfileGraph.pointsString} />
                  {elevationProfileGraph.points.map((point, index) => (
                    <circle key={`hud-elevation-point-${index}`} className={index === elevationProfileGraph.points.length - 1 ? 'hud-elevation-point active' : 'hud-elevation-point'} cx={point.x} cy={point.y} r="1.7" />
                  ))}
                </svg>
                <div className="hud-elevation-meta">
                  <div className="hud-elevation-meta__row">
                    <span>{formatFeetValue(elevationProfileGraph.maxElevation)}</span>
                    <span>{formatFeetValue(elevationProfileGraph.minElevation)}</span>
                  </div>
                  <div className="hud-elevation-meta__row hud-elevation-meta__row--distance">
                    <span>0.0 mi</span>
                    <span>{elevationProfileGraph.totalMiles.toFixed(1)} mi</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {fileManagerOpen && (
          <div className="file-manager-modal" role="dialog" aria-modal="true" aria-label="File manager" onClick={() => setFileManagerOpen(false)}>
            <div
              ref={fileManagerWindowRef}
              className={fileManagerFullscreen ? 'file-manager-window fullscreen' : 'file-manager-window'}
              style={
                fileManagerFullscreen
                  ? undefined
                  : {
                      left: `${fileManagerPosition.x}px`,
                      top: `${fileManagerPosition.y}px`,
                    }
              }
              onClick={(event) => event.stopPropagation()}
            >
              <header className="file-manager-titlebar" onPointerDown={beginFileManagerDrag}>
                <div>
                  <strong>File manager</strong>
                  <span>Organize imported routes and activity files</span>
                </div>
                <div className="file-manager-titlebar-actions">
                  <button className="file-manager-titlebar-button" onClick={toggleFileManagerFullscreen} aria-label={fileManagerFullscreen ? 'Restore window' : 'Maximize window'}>
                    {fileManagerFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                  </button>
                  <button className="file-manager-close" onClick={() => setFileManagerOpen(false)}>
                    Close
                  </button>
                </div>
              </header>

              <div className="file-manager-toolbar">
                <div className="file-manager-toolbar-actions">
                  <button className="file-manager-toolbar-button" onClick={createNewFolder}>
                    <FolderPlus size={14} />
                    <span>New folder</span>
                  </button>
                  <button className="file-manager-toolbar-button file-manager-toolbar-button--danger" onClick={deleteAllImportedFiles}>
                    <Trash2 size={14} />
                    <span>Delete all files</span>
                  </button>
                  <button
                    className="file-manager-toolbar-button"
                    onClick={() => {
                      if (!fileBrowserSelection) return
                      if (fileBrowserSelection.kind === 'folder') {
                        renameFolder(fileBrowserSelection.id)
                        return
                      }
                      renameSelectedImportedFile()
                    }}
                    disabled={!fileBrowserSelection}
                  >
                    <PenLine size={14} />
                    <span>Rename</span>
                  </button>
                  <button
                    className="file-manager-toolbar-button"
                    onClick={() => {
                      if (!fileBrowserSelection) return
                      if (fileBrowserSelection.kind === 'folder') {
                        deleteFolder(fileBrowserSelection.id)
                        return
                      }
                      deleteSelectedImportedFile()
                    }}
                    disabled={!fileBrowserSelection}
                  >
                    <Trash2 size={14} />
                    <span>Delete</span>
                  </button>
                  <label className="file-manager-toolbar-button file-manager-toolbar-upload">
                    <Upload size={14} />
                    <span>Import more</span>
                    <input type="file" accept=".gpx,.tcx,.geojson,.json,.fit" multiple onChange={handleImport} hidden />
                  </label>
                </div>
                <div className="file-manager-toolbar-secondary">
                  <label className="file-manager-search">
                    <Search size={14} />
                    <input
                      type="search"
                      value={fileBrowserSearch}
                      onChange={(event) => setFileBrowserSearch(event.target.value)}
                      placeholder="Search files"
                    />
                  </label>
                  <label className="file-manager-sort">
                    <ArrowUpDown size={14} />
                    <select value={fileBrowserSort} onChange={(event) => setFileBrowserSort(event.target.value)}>
                      <option value="updated">Sort by updated</option>
                      <option value="date">Sort by date</option>
                      <option value="name">Sort by name</option>
                      <option value="type">Sort by type</option>
                    </select>
                  </label>
                </div>
              </div>

              <div className="file-manager-body">
                <aside className="file-manager-sidebar">
                  <div className="file-manager-sidebar-head">
                    <span>Folders</span>
                    <button className="file-manager-mini-button" onClick={createNewFolder}>
                      <FolderPlus size={14} />
                    </button>
                  </div>
                  <div className="file-manager-folder-list">
                    {fileBrowserFolders.map((folder) => (
                      <button
                        key={folder.id}
                        className={[
                          fileBrowserFolderId === folder.id ? 'file-manager-folder active' : 'file-manager-folder',
                          fileBrowserDropFolderId === folder.id ? 'drag-over' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => selectFileFolder(folder.id)}
                        onDragOver={(event) => {
                          if (!fileBrowserDragId) return
                          event.preventDefault()
                          setFileBrowserDropFolderId(folder.id)
                        }}
                        onDragEnter={(event) => {
                          if (!fileBrowserDragId) return
                          event.preventDefault()
                          setFileBrowserDropFolderId(folder.id)
                        }}
                        onDragLeave={() => {
                          if (fileBrowserDropFolderId === folder.id) {
                            setFileBrowserDropFolderId(null)
                          }
                        }}
                        onDrop={(event) => {
                          if (!fileBrowserDragId) return
                          event.preventDefault()
                          moveImportedFile(fileBrowserDragId, folder.id)
                          setFileBrowserDragId(null)
                          setFileBrowserDropFolderId(null)
                        }}
                      >
                        <Folder size={14} />
                        <span>{folder.name}</span>
                        <small>{folder.count || 0}</small>
                      </button>
                    ))}
                  </div>

                  <div className="file-manager-sidebar-section">
                    <span className="file-manager-sidebar-kicker">Folder actions</span>
                    <button className="file-manager-sidebar-action" onClick={createNewFolder}>
                      Create folder
                    </button>
                    <button
                      className="file-manager-sidebar-action"
                      onClick={() => fileBrowserFolderMeta && !fileBrowserFolderMeta.builtIn && fileBrowserFolderMeta.id !== 'all' && renameFolder(fileBrowserFolderMeta.id)}
                      disabled={!fileBrowserFolderMeta || fileBrowserFolderMeta.builtIn || fileBrowserFolderMeta.id === 'all'}
                    >
                      Rename folder
                    </button>
                    <button
                      className="file-manager-sidebar-action"
                      onClick={() => fileBrowserFolderMeta && !fileBrowserFolderMeta.builtIn && fileBrowserFolderMeta.id !== 'all' && deleteFolder(fileBrowserFolderMeta.id)}
                      disabled={!fileBrowserFolderMeta || fileBrowserFolderMeta.builtIn || fileBrowserFolderMeta.id === 'all'}
                    >
                      Delete folder
                    </button>
                  </div>
                </aside>

                <section className="file-manager-mainpane">
                  <div className="file-manager-path">
                    <strong>{fileBrowserFolderMeta?.name || 'All files'}</strong>
                    <span>
                      {fileBrowserItems.length} item{fileBrowserItems.length === 1 ? '' : 's'}
                      {fileBrowserSearch.trim() ? ` · filtered by “${fileBrowserSearch.trim()}”` : ''}
                    </span>
                  </div>

                  <div className="file-manager-grid" role="list" aria-label="Imported files">
                    {fileBrowserItems.length ? (
                      fileBrowserItems.map((entry) => {
                        const folderName = getFolderLabel(entry.folderId)
                        return (
                          <button
                            key={entry.id}
                            draggable
                            className={[
                              fileBrowserSelectionId === entry.id ? 'file-manager-tile active' : 'file-manager-tile',
                              fileBrowserDragId === entry.id ? 'dragging' : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            role="listitem"
                            onClick={() => setFileBrowserSelectionId(entry.id)}
                            onDoubleClick={() => openImportedFile(entry.id)}
                            onDragStart={(event) => {
                              event.dataTransfer.effectAllowed = 'move'
                              event.dataTransfer.setData('text/plain', entry.id)
                              setFileBrowserSelectionId(entry.id)
                              setFileBrowserDragId(entry.id)
                            }}
                            onDragEnd={() => {
                              setFileBrowserDragId(null)
                              setFileBrowserDropFolderId(null)
                            }}
                          >
                            <div className="file-manager-tile-icon">
                              <FileText size={16} />
                            </div>
                            <div className="file-manager-tile-text">
                              <strong>{entry.displayName}</strong>
                              <span>{entry.place?.name || entry.sourceName}</span>
                            </div>
                            <div className="file-manager-tile-meta">
                              <small>{entry.sourceFormat || 'file'}</small>
                              <span>{folderName}</span>
                            </div>
                          </button>
                        )
                      })
                    ) : (
                      <div className="file-manager-empty">
                        <strong>No files here</strong>
                        <span>Import a file or drag one into a folder from the sidebar.</span>
                      </div>
                    )}
                  </div>
                </section>

                <aside className="file-manager-details">
                  <div className="file-manager-details-head">
                    <span>Details</span>
                    <strong>{fileBrowserSelection?.displayName || 'Nothing selected'}</strong>
                  </div>

                  {fileBrowserSelection ? (
                    <>
                      <div className="file-manager-detail-card">
                        <span>Type</span>
                        <strong>{fileBrowserSelection.sourceFormat || 'Imported file'}</strong>
                      </div>
                      <div className="file-manager-detail-card">
                        <span>Folder</span>
                        <strong>{getFolderLabel(fileBrowserSelection.folderId)}</strong>
                      </div>
                      <div className="file-manager-detail-card">
                        <span>Updated</span>
                        <strong>{fileBrowserSelection.updatedAt ? new Date(fileBrowserSelection.updatedAt).toLocaleString() : 'Unknown'}</strong>
                      </div>
                      <div className="file-manager-detail-card">
                        <span>Linked item</span>
                        <strong>{fileBrowserSelection.place?.name || 'Not opened'}</strong>
                      </div>
                      <div className="file-manager-detail-card file-manager-detail-card--color">
                        <span>Route color</span>
                        <div className="file-manager-color-row">
                          <input
                            type="color"
                            value={fileBrowserSelection.routeColor || DEFAULT_ROUTE_COLOR}
                            onChange={(event) => updateImportedRouteColor(fileBrowserSelection.id, event.target.value)}
                            aria-label="Route color"
                          />
                          <button
                            className="file-manager-action-button"
                            onClick={() => updateImportedRouteColor(fileBrowserSelection.id, DEFAULT_ROUTE_COLOR)}
                            disabled={(fileBrowserSelection.routeColor || DEFAULT_ROUTE_COLOR) === DEFAULT_ROUTE_COLOR}
                          >
                            Reset
                          </button>
                        </div>
                      </div>

                      <div className="file-manager-action-group">
                        <button className="file-manager-action-button primary" onClick={() => openImportedFile(fileBrowserSelection.id)}>
                          Open
                        </button>
                        <button className="file-manager-action-button" onClick={() => saveImportedEntry(fileBrowserSelection.id)}>
                          Save copy
                        </button>
                        <button className="file-manager-action-button" onClick={renameSelectedImportedFile}>
                          Rename file
                        </button>
                      </div>

                      <div className="file-manager-move-group">
                        <span>Move to</span>
                        {fileBrowserFolders
                          .filter((folder) => folder.id !== 'all')
                          .map((folder) => (
                            <button
                              key={folder.id}
                              className={fileBrowserSelection.folderId === folder.id ? 'file-manager-folder-chip active' : 'file-manager-folder-chip'}
                              onClick={() => moveSelectedImportedFile(folder.id)}
                              disabled={folder.id === fileBrowserSelection.folderId}
                            >
                              {folder.name}
                            </button>
                          ))}
                      </div>
                    </>
                  ) : (
                    <div className="file-manager-empty details">
                      <strong>Select a file</strong>
                      <span>Choose an item from the list to see actions and metadata.</span>
                    </div>
                  )}
                </aside>
              </div>
            </div>
          </div>
        )}

        {logContextMenu && (
          <>
            <div className="log-context-menu-backdrop" onClick={closeLogContextMenu} onContextMenu={(event) => event.preventDefault()} />
            <div className="log-context-menu" style={{ left: `${logContextMenu.x}px`, top: `${logContextMenu.y}px` }} role="menu" aria-label="Log options" onClick={(event) => event.stopPropagation()}>
              <button
                className="log-context-menu-item"
                role="menuitem"
                onClick={() => {
                  openPlaceDetails(logContextMenu.placeId)
                  closeLogContextMenu()
                }}
              >
                Open details
              </button>
              <button className="log-context-menu-item" role="menuitem" onClick={() => openMediaUploadForPlace(logContextMenu.placeId)}>
                Add media
              </button>
              <button
                className="log-context-menu-item"
                role="menuitem"
                onClick={() => {
                  handleSelectPlace(logContextMenu.placeId)
                  setFocusPlaceId(logContextMenu.placeId)
                  closeLogContextMenu()
                }}
              >
                Focus on map
              </button>
              <button
                className="log-context-menu-item danger"
                role="menuitem"
                onClick={() => {
                  deleteLogPlace(logContextMenu.placeId)
                }}
              >
                Delete
              </button>
              <button className="log-context-menu-item" role="menuitem" onClick={closeLogContextMenu}>
                Close
              </button>
            </div>
          </>
        )}

        <input
          ref={mediaUploadInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          onChange={handleSelectedMediaUpload}
        />

        {activityDrawerOpen && selected && selected.kind !== 'waypoint' && (
          <aside className="activity-drawer" aria-label="Activity details">
            <div className="activity-drawer-head">
              <div>
                <strong>{selected.kind === 'run' ? `${selected.activityLabel || 'Run'} details` : 'Place details'}</strong>
                <span>{selected.name}</span>
              </div>
              <div className="activity-drawer-head-actions">
                {selected.phase === 'future' && !activityDrawerEditMode && (
                  <button
                    className={planningMarkersVisible ? 'activity-drawer-plan active' : 'activity-drawer-plan'}
                    onClick={() => setPlanningMarkersVisible((current) => !current)}
                    aria-label={planningMarkersVisible ? 'Hide planning markers' : 'Show planning markers'}
                    aria-pressed={planningMarkersVisible}
                  >
                    {planningMarkersVisible ? 'Markers: On' : 'Markers: Off'}
                  </button>
                )}
                {planningToolOpen && selected.phase === 'future' ? (
                  <>
                    <button className="activity-drawer-plan" onClick={savePlanningTools} aria-label="Save plan">
                      Save
                    </button>
                    <button
                      className="activity-drawer-plan active"
                      onClick={togglePlanningTools}
                      aria-label="Hide planning tools"
                      aria-pressed={planningToolOpen}
                    >
                      Plan
                    </button>
                  </>
                ) : (
                  <>
                    {selected.phase === 'future' && !activityDrawerEditMode && (
                      <button
                        className={planningToolOpen ? 'activity-drawer-plan active' : 'activity-drawer-plan'}
                        onClick={togglePlanningTools}
                        aria-label={planningToolOpen ? 'Hide planning tools' : 'Show planning tools'}
                        aria-pressed={planningToolOpen}
                      >
                        Plan
                      </button>
                    )}
                    {activityDrawerEditMode ? (
                      <button className="activity-drawer-edit" onClick={saveSelectedLogEdits} aria-label="Save activity edits">
                        Save
                      </button>
                    ) : (
                      <button
                        className="activity-drawer-edit"
                        onClick={() => {
                          setActivityDrawerEditMode(true)
                          setLogTitleDraft(selected.name || '')
                          setLogRouteColorDraft(selectedRouteColor)
                        }}
                        aria-label="Edit activity details"
                      >
                        Edit
                      </button>
                    )}
                  </>
                )}
                <button className="activity-drawer-close" onClick={closeActivityDrawerCompletely} aria-label="Close activity details">
                  Close
                </button>
              </div>
            </div>

            {planningToolOpen && selected.phase === 'future' ? (
              <div className="activity-drawer-section">
                <span className="activity-drawer-kicker">Planning</span>
                <div className="activity-drawer-edit-stack">
                  <label className="activity-drawer-field">
                    <span>Target miles per day</span>
                    <input
                      type="number"
                      min="0.1"
                      step="0.1"
                      value={planningMilesPerDayDraft}
                      onChange={(event) => setPlanningMilesPerDayDraft(event.target.value)}
                      placeholder="Enter miles per day"
                    />
                  </label>

                  <button
                    className={planningReverseDraft ? 'activity-drawer-plan-toggle active' : 'activity-drawer-plan-toggle'}
                    onClick={() => setPlanningReverseDraft((current) => !current)}
                    aria-pressed={planningReverseDraft}
                  >
                    {planningReverseDraft ? 'Reverse direction: On' : 'Reverse direction: Off'}
                  </button>

                  <div className="activity-drawer-grid">
                    <div className="activity-drawer-card">
                      <span>Total distance</span>
                      <strong>{Number.isFinite(selectedRouteMiles) ? `${selectedRouteMiles.toFixed(1)} mi` : 'n/a'}</strong>
                    </div>
                    <div className="activity-drawer-card">
                      <span>Estimated days</span>
                      <strong>{formatPlanningDays(planningEstimatedDays)}</strong>
                    </div>
                  </div>

                  <div className="activity-drawer-list">
                    {routePlanningAnalysis.days.length ? (
                      routePlanningAnalysis.days.map((day) => (
                        <div key={`plan-day-${day.day}`} className="activity-drawer-row activity-drawer-row--plan">
                          <span>
                            Day {day.day}
                            <small>{day.difficultyLabel}</small>
                          </span>
                          <div className="activity-drawer-plan-adjuster">
                            <button
                              className="activity-drawer-plan-step"
                              onClick={() => adjustPlanningDayMiles(day.day - 1, -0.5)}
                              aria-label={`Reduce day ${day.day} by half a mile`}
                              disabled={!planningDayMilesDraft.length}
                            >
                              −
                            </button>
                            <strong>{day.miles.toFixed(1)} mi</strong>
                            <button
                              className="activity-drawer-plan-step"
                              onClick={() => adjustPlanningDayMiles(day.day - 1, 0.5)}
                              aria-label={`Increase day ${day.day} by half a mile`}
                              disabled={!planningDayMilesDraft.length}
                            >
                              +
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="activity-drawer-empty">Add a pace to see daily breakpoints.</div>
                    )}
                  </div>

                  <div className="activity-drawer-grid activity-drawer-grid--plan-footer">
                    <div className="activity-drawer-card">
                      <span>Total distance</span>
                      <strong>{Number.isFinite(routePlanningAnalysis.totals?.distanceMiles) ? `${routePlanningAnalysis.totals.distanceMiles.toFixed(1)} mi` : 'n/a'}</strong>
                    </div>
                    <div className="activity-drawer-card">
                      <span>Planned days</span>
                      <strong>{formatPlanningDays(planningEstimatedDays)}</strong>
                    </div>
                  </div>

                  <button className="activity-drawer-plan-toggle" onClick={resetPlanningDayMiles} disabled={!selectedRouteMiles}>
                    Reset day miles
                  </button>

                  <div className="activity-drawer-empty">
                    {planningReverseDraft ? 'Markers run from the opposite end of the route.' : 'Markers run from the start of the route.'}
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="activity-drawer-section">
                  <span className="activity-drawer-kicker">Edit</span>
                  <div className="activity-drawer-edit-stack">
                    <label className="activity-drawer-field">
                      <span>Title</span>
                      <input
                        type="text"
                        value={logTitleDraft}
                        onChange={(event) => setLogTitleDraft(event.target.value)}
                        disabled={!activityDrawerEditMode}
                        placeholder="Enter a title"
                      />
                    </label>

                    {selectedRouteGeoJson && (
                      <label className="activity-drawer-field">
                        <span>GeoJSON color</span>
                        <div className="activity-drawer-color-row">
                          <input
                            type="color"
                            value={logRouteColorDraft}
                            onChange={(event) => setLogRouteColorDraft(event.target.value)}
                            disabled={!activityDrawerEditMode}
                            aria-label="GeoJSON color"
                          />
                          <button
                            className="activity-drawer-reset-button"
                            onClick={() => setLogRouteColorDraft(DEFAULT_ROUTE_COLOR)}
                            disabled={!activityDrawerEditMode}
                          >
                            Reset
                          </button>
                        </div>
                      </label>
                    )}

                    {(selected.phase === 'past' || selected.phase === 'future') && (
                      <label className="activity-drawer-field">
                        <span>List</span>
                        <select
                          value={logPhaseDraft}
                          onChange={(event) => setLogPhaseDraft(event.target.value)}
                          disabled={!activityDrawerEditMode}
                        >
                          <option value="past">Logbook</option>
                          <option value="future">Future</option>
                        </select>
                      </label>
                    )}
                  </div>
                </div>

                <div className="activity-drawer-section">
                  <span className="activity-drawer-kicker">Summary</span>
                  <div className="activity-drawer-grid">
                    {(
                      selected.kind === 'run'
                        ? [
                            { label: 'Type', value: titleCase(selected.activityType || 'run') },
                            { label: 'Status', value: selected.status || 'Imported activity' },
                            { label: 'Distance', value: selected.distance || 'n/a' },
                            { label: 'Duration', value: selected.duration || 'n/a' },
                            { label: 'Recorded', value: selected.recordedAt ? new Date(selected.recordedAt).toLocaleString() : 'n/a' },
                            { label: 'Source', value: selected.importedFrom || 'n/a' },
                          ]
                        : [
                            { label: 'Phase', value: titleCase(selected.phase || 'place') },
                            { label: 'Status', value: selected.status || 'Saved place' },
                            { label: 'Source', value: selected.source || 'Pinned place' },
                            { label: 'Recorded', value: selected.recordedAt ? new Date(selected.recordedAt).toLocaleString() : 'n/a' },
                            { label: 'Location', value: `${selected.lat.toFixed(4)}, ${selected.lng.toFixed(4)}` },
                            { label: 'Notes', value: selected.summary || 'No summary yet.' },
                            selectedPlanMilesPerDay ? { label: 'Plan target', value: `${selectedPlanMilesPerDay.toFixed(1)} mi/day` } : null,
                            selectedPlanDays ? { label: 'Plan days', value: formatPlanningDays(selectedPlanDays) } : null,
                          ]
                    )
                      .filter(Boolean)
                      .map((item) => (
                        <div key={item.label} className="activity-drawer-card">
                          <span>{item.label}</span>
                          <strong>{item.value}</strong>
                        </div>
                      ))}
                  </div>
                </div>

                {selected.kind === 'run' && (
                  <>
                    <div className="activity-drawer-section">
                      <span className="activity-drawer-kicker">Activity Type</span>
                      <div className="activity-drawer-chiprow">
                        {ACTIVITY_TYPES.map((option) => (
                          <button
                            key={option.id}
                            className={selected.activityType === option.id ? 'activity-chip active' : 'activity-chip'}
                            onClick={() => setRunActivityType(selected.id, option.id)}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="activity-drawer-section">
                      <span className="activity-drawer-kicker">Garmin Data</span>
                      <div className="activity-drawer-list">
                        {selectedGarminItems.length ? (
                          selectedGarminItems.map((item) => (
                            <button key={item.label} className="activity-drawer-row" onClick={() => setImportStatus(`${item.label}: ${item.value}`)}>
                              <span>{item.label}</span>
                              <strong>{item.value}</strong>
                            </button>
                          ))
                        ) : (
                          <div className="activity-drawer-empty">No Garmin summary data found in this file.</div>
                        )}
                      </div>
                    </div>
                  </>
                )}

                <div className="activity-drawer-section">
                  <span className="activity-drawer-kicker">Media</span>
                  <div className="media-upload-row">
                    <label className="hud-subpill upload-button" style={hudTone('selected')}>
                      <span>Add photo or video</span>
                      <input type="file" accept="image/*,video/*" multiple onChange={handleSelectedMediaUpload} hidden />
                    </label>
                    <span className="media-upload-hint">
                      {selectedMediaEntries.length} item{selectedMediaEntries.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  {selectedMediaEntries.length ? (
                    <div className="media-grid place-media-grid">
                      {selectedMediaEntries.map((entry) => (
                        <div key={entry.id} className="media-card place-media-card">
                          {entry.kind === 'video' ? (
                            <video src={entry.url} controls playsInline />
                          ) : (
                            <img src={entry.url} alt={entry.name} />
                          )}
                          <div className="media-card-footer">
                            <strong>{entry.name}</strong>
                            <button className="media-delete-button" onClick={() => deleteSelectedMedia(entry.id)}>
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="activity-drawer-empty">No media attached yet.</div>
                  )}
                </div>
              </>
            )}
          </aside>
        )}

        <div className="settings-wheel-wrap">
          {settingsOpen && (
            <div className="settings-popover" role="dialog" aria-label="Button color settings">
              <div className="settings-title">
                <span>Button color</span>
                <small>Pick a tone for the overlay buttons.</small>
              </div>
              <div className="settings-swatches">
                {HUD_COLOR_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    className={buttonColor === preset ? 'settings-swatch active' : 'settings-swatch'}
                    style={{ '--swatch-color': preset }}
                    onClick={() => setButtonColor(preset)}
                    aria-label={`Set button color to ${preset}`}
                    title={preset}
                  />
                ))}
              </div>
              <label className="settings-picker">
                <span>Custom</span>
                <input type="color" value={buttonColor} onChange={(event) => setButtonColor(event.target.value)} />
              </label>
              <label className="settings-picker settings-opacity">
                <span>Opacity</span>
                <div className="settings-opacity-row">
                  <input
                    type="range"
                    min="0.35"
                    max="1"
                    step="0.01"
                    value={buttonOpacity}
                    onChange={(event) => setButtonOpacity(Number.parseFloat(event.target.value))}
                  />
                  <strong>{Math.round(buttonOpacity * 100)}%</strong>
                </div>
              </label>
            </div>
          )}

          <button
            className={settingsOpen ? 'settings-wheel active' : 'settings-wheel'}
            onClick={() => setSettingsOpen((current) => !current)}
            aria-label="Open button color settings"
            title="Button color settings"
          >
            <Settings2 size={18} />
          </button>
        </div>

        <div className="support-wheel-wrap" aria-label="Support link">
          <a
            className="support-wheel"
            href="https://www.buymeacoffee.com/downforwhatever"
            target="_blank"
            rel="noreferrer"
            aria-label="Support me on Buy Me a Coffee"
            title="Support me on Buy Me a Coffee"
          >
            <Coffee size={18} />
          </a>
        </div>

        <div className="screenshot-wheel-wrap">
          {screenshotOpen && (
            <div className="screenshot-popover" role="dialog" aria-label="Screenshot tools">
              <div className="settings-title">
                <span>Screenshot</span>
                <small>Drag on the map to draw a rectangle, then review the capture before sharing.</small>
              </div>
              <button
                className="screenshot-switch"
                onClick={() => setScreenshotIncludeLogs((current) => !current)}
                aria-pressed={screenshotIncludeLogs}
              >
                <span className="screenshot-switch__label">{screenshotIncludeLogs ? 'Include icons' : 'Exclude icons'}</span>
                <span className={screenshotIncludeLogs ? 'screenshot-switch__track active' : 'screenshot-switch__track'}>
                  <span className="screenshot-switch__thumb" />
                </span>
              </button>
              <button className="screenshot-action" onClick={() => captureMapScreenshot(screenshotRegion)} disabled={!screenshotRegion}>
                <Camera size={16} />
                <span>{screenshotRegion ? 'Capture selection' : 'Draw a selection first'}</span>
              </button>
              <button className="screenshot-action secondary" onClick={clearScreenshotSelection} disabled={!screenshotRegion && !screenshotDrag}>
                <span>Clear selection</span>
              </button>
              <button className="screenshot-action secondary" onClick={() => setScreenshotOpen(false)}>
                <span>Close</span>
              </button>
            </div>
          )}

          <button
            className={screenshotOpen ? 'screenshot-wheel active' : 'screenshot-wheel'}
            onClick={() => setScreenshotOpen((current) => !current)}
            aria-label="Open screenshot tools"
            title="Screenshot tools"
          >
            <Camera size={18} />
          </button>
        </div>

        {screenshotPreview && (
          <div className="screenshot-preview-backdrop" role="dialog" aria-label="Screenshot preview">
            <div className="screenshot-preview">
              <div className="screenshot-preview__head">
                <div>
                  <strong>Screenshot captured</strong>
                  <span>Review it here before sharing or saving.</span>
                </div>
                <button
                  className="screenshot-preview__close"
                  onClick={() => {
                    setScreenshotPreview((current) => {
                      if (current?.url) URL.revokeObjectURL(current.url)
                      return null
                    })
                  }}
                >
                  Close
                </button>
              </div>
              <div className="screenshot-preview__imagewrap">
                <img src={screenshotPreview.url} alt="Captured map selection preview" />
              </div>
              <div className="screenshot-preview__actions">
                <button className="screenshot-preview__button" onClick={shareCapturedScreenshot}>
                  Share
                </button>
                <button className="screenshot-preview__button" onClick={saveCapturedScreenshot}>
                  Save
                </button>
                <button
                  className="screenshot-preview__button secondary"
                  onClick={() => {
                    setScreenshotPreview((current) => {
                      if (current?.url) URL.revokeObjectURL(current.url)
                      return null
                    })
                    setScreenshotOpen(true)
                  }}
                >
                  Retake
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

export default App


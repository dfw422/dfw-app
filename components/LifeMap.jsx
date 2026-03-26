import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MapboxMap, { Layer, Marker, Source } from 'react-map-gl/mapbox'
import { Bike, CarFront, Dumbbell, Footprints, MapPinned, Mountain, PersonStanding, Snowflake, Target, Waves } from 'lucide-react'
import 'mapbox-gl/dist/mapbox-gl.css'

const TERRAIN_SOURCE_ID = 'dfw-terrain-dem'
const ROUTE_SAMPLE_SPACING_METERS = 100

function RunGlyph({ size = 16, stroke = 'currentColor' }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true">
      <circle cx="16.5" cy="4.75" r="2" stroke={stroke} strokeWidth="2" />
      <path d="M10.5 19.5 12.4 15l-2.4-2.2-2.5 2.1" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m12.2 10.6 2.8 1.7 2.1 4.2" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.3 12.8 11 11l1.6-3.3 2.8-.2" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m7 20 5.4-4.7 3.4 4.7" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const ACTIVITY_MARKERS = {
  run: { icon: RunGlyph, label: 'Run', tone: 'run' },
  hike: { icon: Mountain, label: 'Hike', tone: 'hike' },
  walk: { icon: Footprints, label: 'Walk', tone: 'walk' },
  ski: { icon: Snowflake, label: 'Ski', tone: 'ski' },
  bike: { icon: Bike, label: 'Bike', tone: 'bike' },
  swim: { icon: Waves, label: 'Swim', tone: 'swim' },
  workout: { icon: Dumbbell, label: 'Workout', tone: 'workout' },
  offroad: { icon: CarFront, label: 'Offroad', tone: 'offroad' },
  archery: { icon: Target, label: 'Archery', tone: 'archery' },
  other: { icon: PersonStanding, label: 'Other', tone: 'other' },
}

function toElevationPoint(coordinate, index, elevation) {
  return {
    index,
    lng: coordinate[0],
    lat: coordinate[1],
    elevation: Number.isFinite(elevation) ? elevation : null,
  }
}

function formatElevationLabel(elevation) {
  if (!Number.isFinite(elevation)) return 'n/a'
  return `${Math.round(elevation)} ft`
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
  const root = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng

  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(root), Math.sqrt(Math.max(0, 1 - root)))
}

function lerp(start, end, ratio) {
  return start + (end - start) * ratio
}

function densifyRouteCoordinates(coordinates, spacingMeters = ROUTE_SAMPLE_SPACING_METERS) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return coordinates || []

  const path = coordinates
    .filter((coordinate) => Array.isArray(coordinate) && Number.isFinite(coordinate[0]) && Number.isFinite(coordinate[1]))
    .map((coordinate) => [coordinate[0], coordinate[1]])

  if (path.length < 2) return path

  const segmentLengths = []
  let totalMeters = 0
  for (let index = 1; index < path.length; index += 1) {
    const segmentMeters = haversineMeters(
      { lng: path[index - 1][0], lat: path[index - 1][1] },
      { lng: path[index][0], lat: path[index][1] },
    )
    segmentLengths.push(segmentMeters)
    totalMeters += segmentMeters
  }

  if (!Number.isFinite(totalMeters) || totalMeters <= 0) return path

  const sampleCount = Math.min(2048, Math.max(2, Math.ceil(totalMeters / spacingMeters) + 1))
  const samples = [path[0]]

  let segmentIndex = 0
  let segmentStartDistance = 0
  let accumulatedDistance = 0

  for (let sampleIndex = 1; sampleIndex < sampleCount - 1; sampleIndex += 1) {
    const targetDistance = (totalMeters * sampleIndex) / (sampleCount - 1)

    while (segmentIndex < segmentLengths.length - 1 && accumulatedDistance + segmentLengths[segmentIndex] < targetDistance) {
      accumulatedDistance += segmentLengths[segmentIndex]
      segmentIndex += 1
      segmentStartDistance = accumulatedDistance
    }

    const segmentMeters = segmentLengths[segmentIndex] || 0
    const start = path[segmentIndex]
    const end = path[segmentIndex + 1] || path[segmentIndex]
    const ratio = segmentMeters > 0 ? (targetDistance - segmentStartDistance) / segmentMeters : 0

    samples.push([
      lerp(start[0], end[0], Math.min(Math.max(ratio, 0), 1)),
      lerp(start[1], end[1], Math.min(Math.max(ratio, 0), 1)),
    ])
  }

  samples.push(path[path.length - 1])
  return samples
}

export default function LifeMap({
  mapboxToken,
  visiblePlaces,
  selected,
  selectedRouteGeoJson,
  selectedRouteColor,
  plannedRouteMarkers,
  showPlannedRouteMarkers,
  onSelectPlace,
  onOpenPlaceDetails,
  onContextMenuPlace,
  onMapClick,
  measureLineGeoJson,
  elevationLineGeoJson,
  elevationPointsGeoJson,
  drawLineGeoJson,
  drawPointsGeoJson,
  drawCurveControlPoints,
  drawPointsVisible,
  drawToolMode,
  drawPathMode,
  activeTool,
  screenshotOpen = false,
  onMove,
  initialViewState,
  onTerrainProfileChange,
  querySpotElevationFeet,
  focusPlaceId,
  onMapReady,
  onUpdateDrawCurveControl,
  onUpdateDrawPoint,
  onRemoveDrawPoint,
  onSuppressNextDrawMapClick,
}) {
  const [isStyleLoaded, setIsStyleLoaded] = useState(false)
  const mapRef = useRef(null)
  const routeSampleTokenRef = useRef(0)
  const routeProfileCacheRef = useRef(new Map())
  const curveDragRef = useRef(null)
  const pointDragRef = useRef(null)

  const selectedRouteCoordinates = useMemo(() => {
    const geometry = selectedRouteGeoJson?.geometry
    if (!geometry) return []
    if (geometry.type === 'LineString') return geometry.coordinates || []
    return []
  }, [selectedRouteGeoJson])

  const getMarkerSpec = useCallback((place) => {
    if (place?.kind !== 'run') {
      return { icon: MapPinned, label: 'Place', tone: 'place' }
    }

    return ACTIVITY_MARKERS[place.activityType] || ACTIVITY_MARKERS.run
  }, [])

  const ensureTerrain = useCallback(async (map) => {
    if (!map || map.getSource?.(TERRAIN_SOURCE_ID)) {
      map?.setTerrain?.({ source: TERRAIN_SOURCE_ID, exaggeration: 1 })
      return true
    }

    try {
      map.addSource(TERRAIN_SOURCE_ID, {
        type: 'raster-dem',
        url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
        tileSize: 512,
        maxzoom: 14,
      })
      map.setTerrain?.({ source: TERRAIN_SOURCE_ID, exaggeration: 1 })
      return true
    } catch {
      return false
    }
  }, [])

  const sampleRouteElevation = useCallback(
    async (map, coordinates, token) => {
      const canSampleViaTerrain = map && typeof map.queryTerrainElevation === 'function'
      if (!map || !coordinates.length || (!querySpotElevationFeet && !canSampleViaTerrain)) {
        onTerrainProfileChange?.([])
        return
      }

      const routeKey = JSON.stringify(coordinates)
      const cachedProfile = routeProfileCacheRef.current.get(routeKey)
      if (Array.isArray(cachedProfile) && cachedProfile.length) {
        onTerrainProfileChange?.(cachedProfile)
        return
      }

      const denseCoordinates = densifyRouteCoordinates(coordinates)
      const sampleCount = Math.min(512, denseCoordinates.length)
      const sampled = new Array(sampleCount)
      const batchSize = 16

      try {
        for (let startIndex = 0; startIndex < sampleCount; startIndex += batchSize) {
          if (token != null && routeSampleTokenRef.current !== token) return

          const batchEnd = Math.min(sampleCount, startIndex + batchSize)
          const batchResults = await Promise.all(
            Array.from({ length: batchEnd - startIndex }, async (_value, offset) => {
              const sampleIndex = startIndex + offset
              const fraction = sampleCount === 1 ? 0 : sampleIndex / (sampleCount - 1)
              const index = Math.round((denseCoordinates.length - 1) * fraction)
              const coordinate = denseCoordinates[index]
              if (!coordinate) return null

              const elevation = querySpotElevationFeet
                ? await querySpotElevationFeet(coordinate[0], coordinate[1], map)
                : canSampleViaTerrain
                  ? map.queryTerrainElevation({ lng: coordinate[0], lat: coordinate[1] }, { exaggerated: false }) * 3.28084
                  : null

              return toElevationPoint(coordinate, index, elevation)
            }),
          )

          batchResults.forEach((point, offset) => {
            sampled[startIndex + offset] = point
          })

          const filtered = sampled.filter((point) => Number.isFinite(point?.elevation))
          if (filtered.length) {
            onTerrainProfileChange?.(filtered)
          }
        }

        const filtered = sampled.filter((point) => Number.isFinite(point?.elevation))
        routeProfileCacheRef.current.set(routeKey, filtered)
        onTerrainProfileChange?.(filtered)
      } catch {
        const filtered = sampled.filter((point) => Number.isFinite(point?.elevation))
        if (filtered.length) {
          onTerrainProfileChange?.(filtered)
        }
      }
    },
    [onTerrainProfileChange, querySpotElevationFeet],
  )

  useEffect(() => {
    routeSampleTokenRef.current += 1
    const currentToken = routeSampleTokenRef.current

    const map = mapRef.current?.getMap?.()
    if (!map || !isStyleLoaded) return undefined

    ensureTerrain(map).then(() => {
      if (routeSampleTokenRef.current !== currentToken) return
      sampleRouteElevation(map, selectedRouteCoordinates, currentToken)
    })

    return undefined
  }, [ensureTerrain, isStyleLoaded, sampleRouteElevation, selectedRouteCoordinates])

  useEffect(() => {
    const map = mapRef.current?.getMap?.()
    if (!map || !isStyleLoaded || !selected) return
    if (focusPlaceId !== selected.id) return

    map.flyTo({
      center: [selected.lng, selected.lat],
      zoom: Math.max(map.getZoom?.() ?? 10, 10),
      essential: true,
      duration: 900,
    })
  }, [focusPlaceId, isStyleLoaded, selected])

  function handleMoveEnd(event) {
    onMove?.(event.viewState)

    const map = mapRef.current?.getMap?.()
    if (!map || typeof map.queryTerrainElevation !== 'function') return
  }

  function beginCurveControlDrag(index, event) {
    event.preventDefault()
    event.stopPropagation()

    const map = mapRef.current?.getMap?.()
    const canvas = map?.getCanvas?.()
    if (!map || !canvas) return

    curveDragRef.current = { index }
    onSuppressNextDrawMapClick?.()

    const handlePointerMove = (moveEvent) => {
      const drag = curveDragRef.current
      if (!drag) return

      const rect = canvas.getBoundingClientRect()
      const point = map.unproject([moveEvent.clientX - rect.left, moveEvent.clientY - rect.top])
      onUpdateDrawCurveControl?.(drag.index, { lng: point.lng, lat: point.lat })
    }

    const handlePointerUp = () => {
      curveDragRef.current = null
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
  }

  function beginPointDrag(index, event) {
    event.preventDefault()
    event.stopPropagation()

    const map = mapRef.current?.getMap?.()
    const canvas = map?.getCanvas?.()
    if (!map || !canvas) return

    pointDragRef.current = { index }
    onSuppressNextDrawMapClick?.()

    const handlePointerMove = (moveEvent) => {
      const drag = pointDragRef.current
      if (!drag) return

      const rect = canvas.getBoundingClientRect()
      const point = map.unproject([moveEvent.clientX - rect.left, moveEvent.clientY - rect.top])
      onUpdateDrawPoint?.(drag.index, { lng: point.lng, lat: point.lat })
    }

    const handlePointerUp = () => {
      pointDragRef.current = null
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
  }

  if (!mapboxToken) {
    return (
      <div className="map-canvas map-fallback">
        <MapPinned size={28} />
        <strong>Mapbox token needed</strong>
        <p>Add <code>VITE_MAPBOX_TOKEN</code> to <code>.env</code> to activate the live map.</p>
      </div>
    )
  }

  return (
    <div className="map-canvas">
      <MapboxMap
        ref={mapRef}
        initialViewState={initialViewState || { longitude: -80.2, latitude: 39.8, zoom: 3.2 }}
        mapboxAccessToken={mapboxToken}
        mapStyle="mapbox://styles/downforwhatever/cmb7wxtyo00t901rudt2s3dum"
        preserveDrawingBuffer={screenshotOpen}
        cursor={activeTool === 'measure' || activeTool === 'draw' || activeTool === 'elevation' ? 'crosshair' : undefined}
        onMoveEnd={handleMoveEnd}
        onClick={(event) => {
          onMapClick?.({
            lng: event?.lngLat?.lng,
            lat: event?.lngLat?.lat,
          })
        }}
        onLoad={(event) => {
          setIsStyleLoaded(true)
          const map = event?.target ?? mapRef.current?.getMap?.()
          onMapReady?.(map)
          ensureTerrain(map)
        }}
      >
        {isStyleLoaded && selectedRouteGeoJson && (
          <Source id="selected-run-route" type="geojson" data={selectedRouteGeoJson}>
            <Layer id="selected-run-route-line" type="line" paint={{ 'line-color': selectedRouteColor || '#4f8cff', 'line-width': 4, 'line-opacity': 0.9 }} />
          </Source>
        )}

        {isStyleLoaded && showPlannedRouteMarkers && plannedRouteMarkers?.length
          ? plannedRouteMarkers.map((marker) => (
              <Marker key={`planned-route-marker-${marker.day}`} longitude={marker.lng} latitude={marker.lat} anchor="center">
                <div className="planned-route-marker" aria-hidden="true">
                  <span className="planned-route-marker__day">Day {marker.day}</span>
                  <span className="planned-route-marker__miles">{marker.miles.toFixed(1)} mi</span>
                  {marker.difficultyLabel ? <span className="planned-route-marker__difficulty">{marker.difficultyLabel}</span> : null}
                </div>
              </Marker>
            ))
          : null}

        {isStyleLoaded && measureLineGeoJson && (
          <Source id="measure-tool-line" type="geojson" data={measureLineGeoJson}>
            <Layer id="measure-tool-line-layer" type="line" paint={{ 'line-color': '#f2b25c', 'line-width': 3, 'line-dasharray': [2, 1], 'line-opacity': 0.95 }} />
          </Source>
        )}

        {isStyleLoaded && measureLineGeoJson && measureLineGeoJson.geometry?.type === 'LineString' && (
          <Source
            id="measure-tool-points"
            type="geojson"
            data={{
              type: 'FeatureCollection',
              features: measureLineGeoJson.geometry.coordinates.map((coordinate, index) => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: coordinate },
                properties: { index: index + 1 },
              })),
            }}
          >
            <Layer
              id="measure-tool-points-layer"
              type="circle"
              paint={{
                'circle-radius': 5,
                'circle-color': '#f2b25c',
                'circle-stroke-color': '#0b1520',
                'circle-stroke-width': 2,
              }}
            />
          </Source>
        )}

        {isStyleLoaded && elevationLineGeoJson && (
          <Source id="elevation-tool-line" type="geojson" data={elevationLineGeoJson}>
            <Layer id="elevation-tool-line-layer" type="line" paint={{ 'line-color': '#9cdbff', 'line-width': 3, 'line-dasharray': [1, 0], 'line-opacity': 0.96 }} />
          </Source>
        )}

        {isStyleLoaded && elevationPointsGeoJson && (
          <Source id="elevation-tool-points" type="geojson" data={elevationPointsGeoJson}>
            <Layer
              id="elevation-tool-points-layer"
              type="circle"
              paint={{
                'circle-radius': 5,
                'circle-color': '#9cdbff',
                'circle-stroke-color': '#0b1520',
                'circle-stroke-width': 2,
              }}
            />
          </Source>
        )}

        {isStyleLoaded && elevationPointsGeoJson?.features?.length
          ? elevationPointsGeoJson.features
              .filter((feature) => Number.isFinite(feature.properties?.elevation))
              .map((feature) => {
                const [lng, lat] = feature.geometry.coordinates
                const label = formatElevationLabel(feature.properties?.elevation)

                return (
                  <Marker key={`elevation-point-label-${feature.properties?.index || label}`} longitude={lng} latitude={lat} anchor="left">
                    <div className="elevation-point-label" aria-hidden="true">
                      {label}
                    </div>
                  </Marker>
                )
              })
          : null}

        {isStyleLoaded && drawLineGeoJson && (
          <Source id="draw-tool-line" type="geojson" data={drawLineGeoJson}>
            <Layer id="draw-tool-line-layer" type="line" paint={{ 'line-color': '#7ad3ff', 'line-width': 3, 'line-dasharray': [1, 0], 'line-opacity': 0.96 }} />
          </Source>
        )}

        {isStyleLoaded && drawToolMode !== 'adjust' && drawPointsGeoJson && drawPointsVisible && (
          <Source id="draw-tool-points" type="geojson" data={drawPointsGeoJson}>
            <Layer
              id="draw-tool-points-layer"
              type="circle"
              paint={{
                'circle-radius': 5,
                'circle-color': '#7ad3ff',
                'circle-stroke-color': '#0b1520',
                'circle-stroke-width': 2,
              }}
            />
          </Source>
        )}

        {isStyleLoaded && drawToolMode === 'adjust' && drawPointsVisible && drawPointsGeoJson?.features?.length ? (
          drawPointsGeoJson.features.map((feature) => {
            const [lng, lat] = feature.geometry.coordinates
            const index = feature.properties?.index ? feature.properties.index - 1 : 0
            return (
              <Marker key={`draw-point-adjust-${index}`} longitude={lng} latitude={lat} anchor="center">
                <button
                  className="marker-button marker-button--draw-control"
                  onPointerDown={(event) => beginPointDrag(index, event)}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                  title="Drag to move this point"
                  aria-label={`Adjust sketch point ${index + 1}`}
                >
                  <span className="marker-icon">
                    <span className="draw-control-dot" />
                  </span>
                </button>
              </Marker>
            )
          })
        ) : null}

        {isStyleLoaded && drawToolMode === 'erase' && drawPointsGeoJson?.features?.length ? (
          drawPointsGeoJson.features.map((feature) => {
            const [lng, lat] = feature.geometry.coordinates
            const index = feature.properties?.index ? feature.properties.index - 1 : 0
            return (
              <Marker key={`draw-point-erase-${index}`} longitude={lng} latitude={lat} anchor="center">
                <button
                  className="marker-button marker-button--draw-control marker-button--erase"
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    onSuppressNextDrawMapClick?.()
                    onRemoveDrawPoint?.(index)
                  }}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                  title="Remove this point"
                  aria-label={`Remove sketch point ${index + 1}`}
                >
                  <span className="marker-icon">
                    <span className="draw-control-dot draw-control-dot--erase">×</span>
                  </span>
                </button>
              </Marker>
            )
          })
        ) : null}

        {isStyleLoaded && drawPathMode === 'curve' && drawPointsVisible && Array.isArray(drawCurveControlPoints) &&
          drawCurveControlPoints.map((control) => (
            <Marker key={`draw-curve-control-${control.index}`} longitude={control.lng} latitude={control.lat} anchor="center">
              <button
                className="marker-button marker-button--draw-control"
                onPointerDown={(event) => beginCurveControlDrag(control.index, event)}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                }}
                title="Drag to bend the curve"
                aria-label={`Curve handle ${control.index + 1}`}
              >
                <span className="marker-icon">
                  <span className="draw-control-dot" />
                </span>
              </button>
            </Marker>
          ))}

        {isStyleLoaded &&
          visiblePlaces.map((place) => {
            const marker = getMarkerSpec(place)
            const Icon = marker.icon
            const label = place.kind === 'run' ? `${place.name} - ${marker.label}` : place.name
            const tooltip = place.kind === 'place' && place.source === 'pinned' ? 'Right-click to delete' : label

            return (
              <Marker key={place.id} longitude={place.lng} latitude={place.lat} anchor="bottom">
                <button
                  className={selected?.id === place.id ? `marker-button active marker-button--${marker.tone}` : `marker-button marker-button--${marker.tone}`}
                  onClick={() => {
                    onSelectPlace(place.id)
                    if (place.kind === 'place') {
                      onOpenPlaceDetails?.(place.id)
                    }
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    onContextMenuPlace?.(place, event)
                  }}
                  title={tooltip}
                  aria-label={label}
                >
                  <span className="marker-icon">
                    <Icon size={16} strokeWidth={2.4} />
                  </span>
                </button>
              </Marker>
            )
          })}

      </MapboxMap>
    </div>
  )
}

import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFitRunFromMessages, importRunFile } from './runImport.js'

function makeFile(name, content) {
  const type = name.endsWith('.json') || name.endsWith('.geojson') ? 'application/json' : 'application/xml'
  return new File([content], name, { type })
}

const sampleGpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="DFW-test">
  <metadata>
    <name>Morning Loop</name>
    <time>2026-03-21T10:00:00Z</time>
    <desc>Easy shakeout.</desc>
  </metadata>
  <trk>
    <name>Morning Loop</name>
    <trkseg>
      <trkpt lat="40.7500" lon="-73.9900"><ele>12</ele><time>2026-03-21T10:00:00Z</time></trkpt>
      <trkpt lat="40.7550" lon="-73.9850"><ele>24</ele><time>2026-03-21T10:15:00Z</time></trkpt>
      <trkpt lat="40.7600" lon="-73.9800"><ele>18</ele><time>2026-03-21T10:30:00Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`

const sampleTcx = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase>
  <Activities>
    <Activity Sport="Running">
      <Id>2026-03-21T11:00:00Z</Id>
      <Notes>Tempo Lunch</Notes>
      <Lap StartTime="2026-03-21T11:00:00Z">
        <TotalTimeSeconds>1800</TotalTimeSeconds>
        <DistanceMeters>8046.72</DistanceMeters>
        <Track>
          <Trackpoint>
            <Time>2026-03-21T11:00:00Z</Time>
            <AltitudeMeters>30</AltitudeMeters>
            <Position><LatitudeDegrees>40.7400</LatitudeDegrees><LongitudeDegrees>-73.9950</LongitudeDegrees></Position>
          </Trackpoint>
          <Trackpoint>
            <Time>2026-03-21T11:15:00Z</Time>
            <AltitudeMeters>45</AltitudeMeters>
            <Position><LatitudeDegrees>40.7450</LatitudeDegrees><LongitudeDegrees>-73.9900</LongitudeDegrees></Position>
          </Trackpoint>
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`

const sampleGeoJson = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        name: 'River Run',
        description: 'GeoJSON import test.',
        recordedAt: '2026-03-21T12:00:00Z',
        distance: 8046.72,
        duration: 1800,
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-73.995, 40.74],
          [-73.99, 40.745],
          [-73.985, 40.75],
        ],
      },
    },
  ],
})

test('imports GPX files into a past-layer run with route and metadata', async () => {
  const run = await importRunFile(makeFile('morning-loop.gpx', sampleGpx))

  assert.equal(run.kind, 'run')
  assert.equal(run.phase, 'past')
  assert.equal(run.name, 'Morning Loop')
  assert.equal(run.status, 'Run imported')
  assert.equal(run.note, 'Easy shakeout.')
  assert.equal(run.importedFrom, 'morning-loop.gpx')
  assert.equal(run.recordedAt, '2026-03-21T10:00:00Z')
  assert.equal(run.route.length, 3)
  assert.equal(run.route[0][2], 12)
  assert.equal(run.sourceFormat, 'gpx')
  assert.equal(typeof run.sourceText, 'string')
  assert.match(run.distance, /mi/)
  assert.match(run.duration, /min/)
})

test('imports TCX files into a past-layer run with route and lap metadata', async () => {
  const run = await importRunFile(makeFile('tempo-lunch.tcx', sampleTcx))

  assert.equal(run.kind, 'run')
  assert.equal(run.phase, 'past')
  assert.equal(run.name, 'Tempo Lunch')
  assert.equal(run.status, 'Run imported')
  assert.equal(run.importedFrom, 'tempo-lunch.tcx')
  assert.equal(run.recordedAt, '2026-03-21T11:00:00Z')
  assert.equal(run.route.length, 2)
  assert.equal(run.route[0][2], 30)
  assert.equal(run.distance, '5.0 mi')
  assert.equal(run.duration, '30 min')
})

test('imports GeoJSON files into a past-layer run with route and metadata', async () => {
  const run = await importRunFile(makeFile('river-run.geojson', sampleGeoJson))

  assert.equal(run.kind, 'run')
  assert.equal(run.phase, 'past')
  assert.equal(run.name, 'River Run')
  assert.equal(run.status, 'Run imported')
  assert.equal(run.note, 'GeoJSON import test.')
  assert.equal(run.importedFrom, 'river-run.geojson')
  assert.equal(run.recordedAt, '2026-03-21T12:00:00Z')
  assert.equal(run.route.length, 3)
  assert.equal(run.distance, '5.0 mi')
  assert.equal(run.duration, '30 min')
  assert.equal(run.sourceFormat, 'geojson')
})

test('builds a FIT run from Garmin messages', () => {
  const run = buildFitRunFromMessages(
    {
      recordMesgs: [
        { positionLat: 0, positionLong: 0, altitude: 10, timestamp: new Date('2026-03-21T10:00:00Z') },
        { positionLat: 2147483648 / 1800, positionLong: 2147483648 / 900, altitude: 20, timestamp: new Date('2026-03-21T10:10:00Z') },
      ],
      sessionMesgs: [
        {
          sport: 'running',
          subSport: 'trail_running',
          startTime: new Date('2026-03-21T10:00:00Z'),
          totalDistance: 3218.688,
          totalTimerTime: 900,
        },
      ],
      lapMesgs: [{ startTime: new Date('2026-03-21T10:00:00Z') }],
      activityMesgs: [{ type: 'activity', timestamp: new Date('2026-03-21T10:15:00Z') }],
      fileIdMesgs: [{ type: 'activity' }],
    },
    'watch-activity.fit',
  )

  assert.equal(run.kind, 'run')
  assert.equal(run.phase, 'past')
  assert.equal(run.name, 'Trail Running')
  assert.equal(run.activityType, 'run')
  assert.equal(run.activityLabel, 'Run')
  assert.equal(run.status, 'Run imported')
  assert.equal(run.importedFrom, 'watch-activity.fit')
  assert.equal(run.recordedAt, '2026-03-21T10:00:00.000Z')
  assert.equal(run.route.length, 2)
  assert.equal(run.route[0][2], 10)
  assert.equal(run.distance, '2.0 mi')
  assert.equal(run.duration, '15 min')
  assert.equal(run.note, 'Running | Trail Running')
  assert.equal(run.garminMetrics.heartRate.avg, null)
  assert.equal(run.garminMetrics.altitude.gain, 32.8084)
})

test('classifies Garmin FIT activities from sport metadata', () => {
  const build = (sport, subSport, fallbackName) =>
    buildFitRunFromMessages(
      {
        recordMesgs: [],
        sessionMesgs: [
          {
            sport,
            subSport,
            startTime: new Date('2026-03-21T10:00:00Z'),
          },
        ],
        lapMesgs: [],
        activityMesgs: [],
        fileIdMesgs: [{ type: 'activity' }],
      },
      fallbackName,
    )

  const cases = [
    ['cycling', 'road_biking', 'bike', 'Bike'],
    ['walking', 'generic', 'walk', 'Walk'],
    ['swimming', 'open_water', 'swim', 'Swim'],
    ['snow_sports', 'downhill_skiing', 'ski', 'Ski'],
    ['hiking', 'generic', 'hike', 'Hike'],
    ['archery', 'generic', 'archery', 'Archery'],
    ['offroad', 'generic', 'offroad', 'Offroad'],
  ]

  for (const [sport, subSport, expectedType, expectedLabel] of cases) {
    const run = build(sport, subSport, `${sport}.fit`)
    assert.equal(run.activityType, expectedType)
    assert.equal(run.activityLabel, expectedLabel)
    assert.equal(run.status, `${expectedLabel} imported`)
  }
})

test('builds a FIT run without route points when session start coordinates are present', () => {
  const semicircles = (degrees) => (degrees * 2147483648) / 180
  const run = buildFitRunFromMessages(
    {
      recordMesgs: [],
      sessionMesgs: [
        {
          sport: 'running',
          startTime: new Date('2026-03-21T10:00:00Z'),
          startPositionLat: semicircles(40.7128),
          startPositionLong: semicircles(-74.006),
          totalTimerTime: 600,
        },
      ],
      lapMesgs: [],
      activityMesgs: [],
      fileIdMesgs: [{ type: 'activity' }],
    },
    'indoor-fit.fit',
  )

  assert.equal(run.kind, 'run')
  assert.equal(run.phase, 'past')
  assert.equal(run.route.length, 0)
  assert.equal(run.importedFrom, 'indoor-fit.fit')
  assert.equal(run.status, 'Run imported')
  assert.ok(Math.abs(run.lng - -74.006) < 0.0001)
  assert.ok(Math.abs(run.lat - 40.7128) < 0.0001)
  assert.equal(run.duration, '10 min')
})

test('rejects malformed XML with a visible import error', async () => {
  await assert.rejects(
    () => importRunFile(makeFile('broken.gpx', '<gpx><trk></gpx>')),
    /Could not read that file\. Check that it is valid XML\.|No route points found in that file\./,
  )
})

test('rejects files with no route points', async () => {
  const emptyGpx = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1"><trk><name>Empty</name><trkseg></trkseg></trk></gpx>`

  await assert.rejects(
    () => importRunFile(makeFile('empty.gpx', emptyGpx)),
    /No route points found in that file\./,
  )
})

test('rejects malformed GeoJSON with a visible import error', async () => {
  await assert.rejects(
    () => importRunFile(makeFile('broken.geojson', '{ "type": "FeatureCollection", ')),
    /Could not read that file\. Check that it is valid JSON\./,
  )
})

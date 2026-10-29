import React, { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Polyline, useMap } from 'react-leaflet';
import polyline from '@mapbox/polyline';
import { ramp, RAMP_CSS } from './colors.js';

const km = (m) => (m / 1000).toFixed(1);

function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points.length) map.fitBounds(points, { padding: [30, 30] });
  }, [points, map]);
  return null;
}

// Smooth altitude, then compute grade % per segment.
function segments(streams, mode) {
  const { latlng, altitude, distance } = streams;
  const n = latlng.length;
  if (n < 2 || altitude.length !== n) return [];
  const smooth = altitude.map((_, i) => {
    let sum = 0, c = 0;
    for (let j = Math.max(0, i - 3); j <= Math.min(n - 1, i + 3); j++) { sum += altitude[j]; c++; }
    return sum / c;
  });
  const lo = Math.min(...smooth), hi = Math.max(...smooth);
  const out = [];
  for (let i = 1; i < n; i++) {
    const dd = distance[i] - distance[i - 1];
    const grade = dd > 0 ? ((smooth[i] - smooth[i - 1]) / dd) * 100 : 0;
    const t = mode === 'grade' ? (Math.max(-15, Math.min(15, grade)) + 15) / 30 : (smooth[i] - lo) / ((hi - lo) || 1);
    out.push({ pts: [latlng[i - 1], latlng[i]], color: ramp(t) });
  }
  return out;
}

function Legend({ mode, range }) {
  const labels = mode === 'grade' ? ['-15%', '0%', '+15%'] : [`${Math.round(range[0])} m`, '', `${Math.round(range[1])} m`];
  return (
    <div className="legend">
      {mode === 'grade' ? 'Grade' : 'Elevation'}
      <div className="bar" style={{ background: RAMP_CSS }} />
      <div className="ticks">{labels.map((l, i) => <span key={i}>{l}</span>)}</div>
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(null);
  const [runs, setRuns] = useState([]);
  const [selected, setSelected] = useState(null);
  const [streams, setStreams] = useState(null);
  const [mode, setMode] = useState('elevation');
  const [sort, setSort] = useState('gain');
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/status').then((r) => r.json()).then((s) => setAuthed(s.authed));
  }, []);

  useEffect(() => {
    if (!authed) return;
    fetch('/api/activities').then((r) => (r.ok ? r.json() : Promise.reject(new Error('Failed to load activities'))))
      .then(setRuns).catch((e) => setError(e.message));
  }, [authed]);

  useEffect(() => {
    if (!selected) { setStreams(null); return; }
    setStreams(null);
    fetch(`/api/activities/${selected}/streams`).then((r) => r.json()).then(setStreams).catch(() => setStreams(null));
  }, [selected]);

  const decoded = useMemo(
    () => runs.filter((r) => r.polyline).map((r) => ({ id: r.id, pts: polyline.decode(r.polyline) })),
    [runs],
  );
  const sorted = useMemo(() => {
    const key = { gain: (r) => -r.elevationGain, date: (r) => -new Date(r.date), distance: (r) => -r.distance }[sort];
    return [...runs].sort((a, b) => key(a) - key(b));
  }, [runs, sort]);
  const totals = useMemo(() => ({
    gain: runs.reduce((s, r) => s + r.elevationGain, 0),
    dist: runs.reduce((s, r) => s + r.distance, 0),
  }), [runs]);
  const segs = useMemo(() => (streams ? segments(streams, mode) : []), [streams, mode]);
  const fitPoints = selected ? (streams?.latlng || []) : decoded.flatMap((d) => d.pts);
  const altRange = streams?.altitude?.length ? [Math.min(...streams.altitude), Math.max(...streams.altitude)] : [0, 0];

  if (authed === null) return <div className="center">Loading…</div>;
  if (!authed) return <div className="center"><a href="/auth/login"><button>Connect with Strava</button></a></div>;

  return (
    <div className="app">
      <div className="sidebar">
        <h1>chasingVert</h1>
        <div className="stats">{runs.length} runs · {km(totals.dist)} km · {Math.round(totals.gain).toLocaleString()} m gain</div>
        {error && <div style={{ color: 'crimson' }}>{error}</div>}
        <div className="controls">
          {['gain', 'date', 'distance'].map((s) => (
            <button key={s} className={sort === s ? 'active' : ''} onClick={() => setSort(s)}>{s}</button>
          ))}
        </div>
        {selected && (
          <div className="controls">
            <button onClick={() => setSelected(null)}>← All runs</button>
            {['elevation', 'grade'].map((m) => (
              <button key={m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>{m}</button>
            ))}
          </div>
        )}
        {sorted.map((r) => (
          <div key={r.id} className={`run ${r.id === selected ? 'selected' : ''}`} onClick={() => setSelected(r.id)}>
            <b>{r.name}</b>
            <span>{r.date.slice(0, 10)} · {km(r.distance)} km · ▲ {Math.round(r.elevationGain)} m</span>
          </div>
        ))}
      </div>
      <div style={{ position: 'relative' }}>
        <MapContainer className="map" center={[0, 0]} zoom={2}>
          <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <FitBounds points={fitPoints} />
          {!selected && decoded.map((d) => (
            <Polyline key={d.id} positions={d.pts} pathOptions={{ color: '#fc4c02', weight: 2, opacity: 0.25 }}
              eventHandlers={{ click: () => setSelected(d.id) }} />
          ))}
          {selected && segs.map((s, i) => <Polyline key={i} positions={s.pts} pathOptions={{ color: s.color, weight: 5 }} />)}
        </MapContainer>
        {selected && streams && <Legend mode={mode} range={altRange} />}
      </div>
    </div>
  );
}

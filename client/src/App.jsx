import React, { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Polyline, useMap } from 'react-leaflet';
import polyline from '@mapbox/polyline';
import { RAMP_CSS } from './colors.js';
import { pointValues } from './elevation.js';
import { groupRoutes } from './routes.js';
import Heatmap from './Heatmap.jsx';
import RouteSpace from './RouteSpace.jsx';

const km = (m) => (m / 1000).toFixed(1);
const MIN_REPEATS = 5;
const SPORTS = [['all', 'All'], ['run', 'Run'], ['ride', 'Ride'], ['ski', 'Ski'], ['hike', 'Hike']];
const SPORT_COLOR = { run: '#fc4c02', ride: '#1a73e8', ski: '#0b8f6a', hike: '#8e44ad' };

function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points.length) map.fitBounds(points, { padding: [30, 30] });
  }, [points, map]);
  return null;
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
  const [allRuns, setRuns] = useState([]);
  const [sport, setSport] = useState('all');
  const [selected, setSelected] = useState(null);
  const [view3d, setView3d] = useState(false);
  const [streams, setStreams] = useState(null);
  const [mode, setMode] = useState('elevation');
  const [sort, setSort] = useState('gain');
  const [tab, setTab] = useState('runs');
  const [layer, setLayer] = useState('heat');
  const [error, setError] = useState(null);
  const [stats, setStats] = useState({});
  const [calc, setCalc] = useState(null);

  useEffect(() => {
    fetch('/api/status').then((r) => r.json()).then((s) => setAuthed(s.authed));
  }, []);

  useEffect(() => {
    if (!authed) return;
    fetch('/api/activities').then((r) => (r.ok ? r.json() : Promise.reject(new Error('Failed to load activities'))))
      .then(setRuns).catch((e) => setError(e.message));
    fetch('/api/stats').then((r) => r.json()).then(setStats).catch(() => {});
  }, [authed]);

  // Fetch elevation data for ski days one at a time (gentle on Strava's rate limits).
  const calcDescent = async () => {
    const todo = runs.filter((r) => r.sport === 'ski' && !stats[r.id]);
    for (let i = 0; i < todo.length; i++) {
      setCalc({ done: i, total: todo.length });
      const res = await fetch(`/api/activities/${todo[i].id}/streams`);
      if (!res.ok) { setCalc({ done: i, total: todo.length, error: res.status === 429 ? 'Strava rate limit hit — try again in 15 minutes' : `Stopped (${res.status})` }); return; }
      const { stats: st } = await res.json();
      setStats((prev) => ({ ...prev, [todo[i].id]: st }));
      await new Promise((r) => setTimeout(r, 700));
    }
    setCalc(null);
  };

  useEffect(() => {
    setStreams(null);
    if (!selected) return;
    fetch(`/api/activities/${selected}/streams`).then((r) => r.json()).then((d) => {
      setStreams(d);
      if (d.stats) setStats((prev) => ({ ...prev, [selected]: d.stats }));
    }).catch(() => setStreams(null));
  }, [selected]);

  const sportCounts = useMemo(() => allRuns.reduce((c, r) => ({ ...c, [r.sport]: (c[r.sport] || 0) + 1 }), {}), [allRuns]);
  const runs = useMemo(() => (sport === 'all' ? allRuns : allRuns.filter((r) => r.sport === sport)), [allRuns, sport]);
  const decoded = useMemo(
    () => runs.filter((r) => r.polyline).map((r) => ({ ...r, pts: polyline.decode(r.polyline) })),
    [runs],
  );
  const groups = useMemo(() => {
    // never mix sports: a ride and a run on the same road are different routes
    const bySport = Object.groupBy(decoded, (r) => r.sport);
    return Object.values(bySport).flatMap((rs) => groupRoutes(rs, { minRuns: MIN_REPEATS })).sort((a, b) => b.count - a.count);
  }, [decoded]);
  const sorted = useMemo(() => {
    const key = { descent: (r) => -(stats[r.id]?.descent ?? -1), gain: (r) => -r.elevationGain, date: (r) => -new Date(r.date), distance: (r) => -r.distance }[sort];
    return [...runs].sort((a, b) => key(a) - key(b));
  }, [runs, sort, stats]);
  const totals = useMemo(() => ({
    gain: runs.reduce((s, r) => s + r.elevationGain, 0),
    dist: runs.reduce((s, r) => s + r.distance, 0),
  }), [runs]);

  const hasAlt = streams && streams.latlng.length > 1 && streams.altitude.length === streams.latlng.length;
  const segs = useMemo(() => {
    if (!hasAlt) return [];
    const { colors } = pointValues(streams, mode);
    return streams.latlng.slice(1).map((p, i) => ({ pts: [streams.latlng[i], p], color: colors[i + 1] }));
  }, [streams, mode, hasAlt]);
  const routes = useMemo(() => decoded.map((d) => d.pts), [decoded]);
  const fitPoints = selected ? (streams?.latlng || []) : routes.flat();
  const altRange = hasAlt ? [Math.min(...streams.altitude), Math.max(...streams.altitude)] : [0, 0];

  const open = (id, as3d = false) => { setSelected(id); setView3d(as3d); };
  const back = () => { setSelected(null); setView3d(false); };

  if (authed === null) return <div className="center">Loading…</div>;
  if (!authed) return <div className="center"><a href="/auth/login"><button>Connect with Strava</button></a></div>;

  return (
    <div className="app">
      <div className="sidebar">
        <h1>chasingVert</h1>
        <div className="stats">{runs.length} activities · {km(totals.dist)} km · {Math.round(totals.gain).toLocaleString()} m gain</div>
        {error && <div style={{ color: 'crimson' }}>{error}</div>}
        <div className="controls">
          {SPORTS.map(([k, label]) => (
            <button key={k} className={sport === k ? 'active' : ''} onClick={() => { setSport(k); back(); }}>
              {label}{k !== 'all' && ` (${sportCounts[k] || 0})`}
            </button>
          ))}
        </div>
        <div className="controls">
          <button className={tab === 'runs' ? 'active' : ''} onClick={() => setTab('runs')}>Activities</button>
          <button className={tab === 'repeats' ? 'active' : ''} onClick={() => setTab('repeats')}>Repeated routes ({groups.length})</button>
        </div>
        {!selected && (
          <div className="controls">
            <button className={layer === 'heat' ? 'active' : ''} onClick={() => setLayer('heat')}>Heatmap</button>
            <button className={layer === 'lines' ? 'active' : ''} onClick={() => setLayer('lines')}>Routes</button>
          </div>
        )}
        {selected && (
          <div className="controls">
            <button onClick={back}>← Back</button>
            {['elevation', 'grade'].map((m) => (
              <button key={m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>{m}</button>
            ))}
            <button className={view3d ? 'active' : ''} onClick={() => setView3d((v) => !v)} disabled={!hasAlt}>3D</button>
          </div>
        )}
        {selected && stats[selected] && (
          <div className="stats">▲ {stats[selected].gain} m gain · ▼ {stats[selected].descent} m descent</div>
        )}
        {tab === 'runs' && (
          <>
            <div className="controls">
              {['gain', ...(sport === 'ski' ? ['descent'] : []), 'date', 'distance'].map((s) => (
                <button key={s} className={sort === s ? 'active' : ''} onClick={() => setSort(s)}>{s}</button>
              ))}
            </div>
            {sport === 'ski' && (() => {
              const missing = runs.filter((r) => !stats[r.id]).length;
              if (calc && !calc.error) return <div className="stats">Calculating descent… {calc.done}/{calc.total}</div>;
              return (
                <div className="stats">
                  {calc?.error && <div style={{ color: 'crimson' }}>{calc.error}</div>}
                  {missing > 0
                    ? <button onClick={calcDescent}>Calculate descent for {missing} ski days</button>
                    : 'Descent calculated for all ski days'}
                </div>
              );
            })()}
            {sorted.map((r) => (
              <div key={r.id} className={`run ${r.id === selected ? 'selected' : ''}`} onClick={() => open(r.id)}>
                <b>{r.name}</b>
                <span>{r.date.slice(0, 10)} · {r.sportType} · {km(r.distance)} km · ▲ {Math.round(r.elevationGain)} m{stats[r.id] && ` · ▼ ${stats[r.id].descent} m`}</span>
              </div>
            ))}
          </>
        )}
        {tab === 'repeats' && (
          <>
            <div className="stats">Routes you've done {MIN_REPEATS}+ times. Click one to explore it in 3D.</div>
            {groups.length === 0 && <div className="stats">No routes repeated {MIN_REPEATS}+ times yet.</div>}
            {groups.map((g) => (
              <div key={g.id} className={`run ${g.id === selected ? 'selected' : ''}`} onClick={() => open(g.id, true)}>
                <b>{g.count}× {g.name}</b>
                <span>{km(g.distance)} km · ▲ {Math.round(g.elevationGain)} m avg · last {g.runs[0].date.slice(0, 10)}</span>
              </div>
            ))}
          </>
        )}
      </div>
      {selected && view3d && hasAlt ? (
        <RouteSpace streams={streams} mode={mode} />
      ) : (
        <div style={{ position: 'relative' }}>
          <MapContainer className="map" center={[0, 0]} zoom={2}>
            <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <FitBounds points={fitPoints} />
            {!selected && layer === 'heat' && <Heatmap routes={routes} />}
            {!selected && layer === 'lines' && decoded.map((d) => (
              <Polyline key={d.id} positions={d.pts} pathOptions={{ color: SPORT_COLOR[d.sport] || '#fc4c02', weight: 2, opacity: 0.25 }}
                eventHandlers={{ click: () => open(d.id) }} />
            ))}
            {selected && segs.map((s, i) => <Polyline key={i} positions={s.pts} pathOptions={{ color: s.color, weight: 5 }} />)}
          </MapContainer>
          {selected && hasAlt && <Legend mode={mode} range={altRange} />}
        </div>
      )}
    </div>
  );
}

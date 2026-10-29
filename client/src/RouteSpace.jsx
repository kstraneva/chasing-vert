import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Deck, MapView, WebMercatorViewport } from '@deck.gl/core';
import { LineLayer, ScatterplotLayer } from '@deck.gl/layers';
import { TerrainLayer } from '@deck.gl/geo-layers';
import { pointValues } from './elevation.js';
import { RAMP_CSS } from './colors.js';

const toRgb = (s) => s.match(/\d+/g).slice(0, 3).map(Number);
const DEM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const BASEMAPS = {
  satellite: { label: 'Satellite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', credit: 'Imagery © Esri, Maxar, Earthstar Geographics' },
  topo: { label: 'Topo', url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png', credit: '© OpenTopoMap (CC-BY-SA), © OpenStreetMap contributors' },
  esritopo: { label: 'Esri Topo', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', credit: 'Map © Esri, HERE, Garmin, USGS, NPS' },
  streets: { label: 'Streets', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', credit: '© OpenStreetMap contributors' },
};
const LIFT = 8; // metres above the route's recorded altitude, so it isn't buried by DEM mismatch

function gradeAt(i, alt, dist) {
  const a = Math.max(0, i - 5), b = Math.min(alt.length - 1, i + 5);
  const d = dist[b] - dist[a];
  return d > 0 ? ((alt[b] - alt[a]) / d) * 100 : 0;
}

export default function RouteSpace({ streams, mode }) {
  const parent = useRef(null);
  const deckRef = useRef(null);
  const [exag, setExag] = useState(2);
  const [terrain, setTerrain] = useState(true);
  const [basemap, setBasemap] = useState('satellite');
  const [sel, setSel] = useState(null);
  const { latlng, altitude, distance } = streams;
  const n = altitude.length;

  const { colors } = useMemo(() => pointValues(streams, mode), [streams, mode]);
  const minAlt = Math.min(...altitude), maxAlt = Math.max(...altitude);
  const segs = useMemo(() => latlng.slice(1).map((p, i) => ({ i: i + 1, a: latlng[i], b: p, ai: i, color: toRgb(colors[i + 1]) })), [latlng, colors]);

  const layers = useMemo(() => {
    // z is metres * exaggeration, matching the terrain's exaggerated decoder.
    const pos = (ll, k) => [ll[1], ll[0], (altitude[k] + LIFT) * exag];
    const floor = (minAlt - 5) * exag;
    const step = Math.max(1, Math.floor(segs.length / 300));
    const L = [];
    if (terrain) {
      L.push(new TerrainLayer({
        id: 'terrain', elevationData: DEM, texture: BASEMAPS[basemap].url, minZoom: 0, maxZoom: 15, meshMaxError: 4,
        elevationDecoder: { rScaler: 256 * exag, gScaler: exag, bScaler: exag / 256, offset: -32768 * exag },
        color: [255, 255, 255],
      }));
    } else {
      // no terrain: show a ground trace and curtain so heights are readable
      L.push(
        new LineLayer({ id: 'ground', data: segs, getSourcePosition: (d) => [d.a[1], d.a[0], floor], getTargetPosition: (d) => [d.b[1], d.b[0], floor], getColor: [90, 90, 90, 160], getWidth: 2 }),
        new LineLayer({ id: 'curtain', data: segs.filter((_, k) => k % step === 0), getSourcePosition: (d) => [d.a[1], d.a[0], floor],
          getTargetPosition: (d) => pos(d.a, d.ai), getColor: (d) => [...d.color, 70], getWidth: 2, updateTriggers: { getTargetPosition: exag } }),
      );
    }
    L.push(new LineLayer({
      id: 'route-casing', data: segs, getSourcePosition: (d) => pos(d.a, d.ai), getTargetPosition: (d) => pos(d.b, d.i),
      getColor: [0, 0, 0, 200], getWidth: 10, widthMinPixels: 7, parameters: { depthCompare: 'always' },
      updateTriggers: { getSourcePosition: exag, getTargetPosition: exag },
    }), new LineLayer({
      id: 'route', data: segs, pickable: true, getSourcePosition: (d) => pos(d.a, d.ai), getTargetPosition: (d) => pos(d.b, d.i),
      getColor: (d) => [...d.color, 255], getWidth: 6, widthMinPixels: 4, parameters: { depthCompare: 'always' },
      updateTriggers: { getSourcePosition: exag, getTargetPosition: exag },
    }));
    if (sel != null) {
      L.push(new ScatterplotLayer({
        id: 'marker', data: [sel], getPosition: (k) => pos(latlng[k], k), getRadius: 9, radiusUnits: 'pixels',
        getFillColor: [255, 255, 255], getLineColor: [0, 0, 0], stroked: true, lineWidthMinPixels: 2,
        parameters: { depthCompare: 'always' }, updateTriggers: { getPosition: exag },
      }));
    }
    return L;
  }, [segs, exag, sel, terrain, basemap, latlng, altitude, minAlt]);

  useEffect(() => {
    const el = parent.current;
    const lats = latlng.map((p) => p[0]), lngs = latlng.map((p) => p[1]);
    const vp = new WebMercatorViewport({ width: el.clientWidth || 800, height: el.clientHeight || 600 })
      .fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 80 });
    const deck = new Deck({
      parent: el,
      views: new MapView({ repeat: false }),
      initialViewState: { longitude: vp.longitude, latitude: vp.latitude, zoom: Math.min(vp.zoom, 15), pitch: 60, bearing: -20, maxPitch: 85, maxZoom: 18 },
      controller: true,
      getCursor: ({ isHovering }) => (isHovering ? 'pointer' : 'grab'),
      onClick: (info) => { if (info.layer?.id === 'route') setSel(info.object.i); },
    });
    deckRef.current = deck;
    return () => { deck.finalize(); deckRef.current = null; };
  }, [latlng]);

  useEffect(() => { deckRef.current?.setProps({ layers }); }, [layers]);
  useEffect(() => { setSel(null); }, [streams]);

  // Elevation profile (click to select).
  const W = 300, H = 70, total = distance[n - 1] || 1, range = maxAlt - minAlt || 1;
  const px = (i) => (distance[i] / total) * W;
  const py = (a) => H - 4 - ((a - minAlt) / range) * (H - 8);
  const profile = altitude.map((a, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)},${py(a).toFixed(1)}`).join('');
  const pickProfile = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const target = ((e.clientX - r.left) / r.width) * total;
    let best = 0;
    for (let i = 0; i < n; i++) if (Math.abs(distance[i] - target) < Math.abs(distance[best] - target)) best = i;
    setSel(best);
  };

  return (
    <div style={{ position: 'relative', height: '100vh' }}>
      <div ref={parent} style={{ position: 'absolute', inset: 0, background: 'linear-gradient(#e8eef5, #fff)' }} />
      <div className="legend" style={{ bottom: 20, width: 320 }}>
        <b>{mode === 'grade' ? 'Grade' : 'Elevation'}</b> · {Math.round(minAlt)}–{Math.round(maxAlt)} m
        <div className="bar" style={{ background: RAMP_CSS, width: '100%' }} />
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" onClick={pickProfile} style={{ cursor: 'crosshair', background: '#f6f8fa', borderRadius: 4 }}>
          <path d={profile} fill="none" stroke="#fc4c02" strokeWidth="1.5" />
          {sel != null && <line x1={px(sel)} x2={px(sel)} y1="0" y2={H} stroke="#000" strokeWidth="1" />}
        </svg>
        {sel != null ? (
          <div>{(distance[sel] / 1000).toFixed(2)} km · {Math.round(altitude[sel])} m · grade {gradeAt(sel, altitude, distance).toFixed(1)}%</div>
        ) : <div>Click the route or the profile to inspect a point</div>}
        <label>Vertical exaggeration {exag.toFixed(1)}×
          <input type="range" min="1" max="6" step="0.5" value={exag} onChange={(e) => setExag(+e.target.value)} style={{ width: '100%' }} />
        </label>
        <div className="controls">
          {Object.entries(BASEMAPS).map(([k, b]) => (
            <button key={k} className={basemap === k ? 'active' : ''} onClick={() => setBasemap(k)}>{b.label}</button>
          ))}
        </div>
        <label><input type="checkbox" checked={terrain} onChange={(e) => setTerrain(e.target.checked)} /> Terrain</label>
        <div style={{ color: '#666', fontSize: 10 }}>{BASEMAPS[basemap].credit} · Terrain: Mapzen/AWS</div>
        <div style={{ color: '#666' }}>Drag to pan · right-drag (or Ctrl-drag) to rotate and tilt · scroll to zoom</div>
      </div>
    </div>
  );
}

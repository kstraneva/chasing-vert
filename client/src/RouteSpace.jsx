import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Deck, OrbitView } from '@deck.gl/core';
import { LineLayer, ScatterplotLayer } from '@deck.gl/layers';
import { pointValues } from './elevation.js';
import { RAMP_CSS } from './colors.js';

const toRgb = (s) => s.match(/\d+/g).slice(0, 3).map(Number);

// Local metric coordinates: x east, y north, z raw altitude (metres).
function project({ latlng, altitude }) {
  const lat0 = latlng[0][0], lng0 = latlng[0][1];
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111320;
  return latlng.map(([lat, lng], i) => [(lng - lng0) * kx, (lat - lat0) * 110540, altitude[i]]);
}

function gradeAt(i, alt, dist) {
  const a = Math.max(0, i - 5), b = Math.min(alt.length - 1, i + 5);
  const d = dist[b] - dist[a];
  return d > 0 ? ((alt[b] - alt[a]) / d) * 100 : 0;
}

export default function RouteSpace({ streams, mode }) {
  const parent = useRef(null);
  const deckRef = useRef(null);
  const [exag, setExag] = useState(2);
  const [sel, setSel] = useState(null);
  const { altitude, distance } = streams;
  const n = altitude.length;

  const pts = useMemo(() => project(streams), [streams]);
  const { colors } = useMemo(() => pointValues(streams, mode), [streams, mode]);
  const minAlt = Math.min(...altitude), maxAlt = Math.max(...altitude);
  const segs = useMemo(() => pts.slice(1).map((p, i) => ({ i: i + 1, a: pts[i], b: p, color: toRgb(colors[i + 1]) })), [pts, colors]);
  const extent = useMemo(() => {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { x: [Math.min(...xs), Math.max(...xs)], y: [Math.min(...ys), Math.max(...ys)] };
  }, [pts]);

  const z = (p) => (p[2] - minAlt) * exag;

  const layers = useMemo(() => {
    const step = Math.max(1, Math.floor(segs.length / 400));
    const L = [
      // ground trace
      new LineLayer({ id: 'ground', data: segs, getSourcePosition: (d) => [d.a[0], d.a[1], 0], getTargetPosition: (d) => [d.b[0], d.b[1], 0],
        getColor: [90, 90, 90, 160], getWidth: 2 }),
      // curtain from route down to the ground plane
      new LineLayer({ id: 'curtain', data: segs.filter((_, k) => k % step === 0), getSourcePosition: (d) => [d.a[0], d.a[1], 0],
        getTargetPosition: (d) => [d.a[0], d.a[1], z(d.a)], getColor: (d) => [...d.color, 70], getWidth: 2, updateTriggers: { getTargetPosition: exag } }),
      // the route itself, in space
      new LineLayer({ id: 'route', data: segs, pickable: true, getSourcePosition: (d) => [d.a[0], d.a[1], z(d.a)], getTargetPosition: (d) => [d.b[0], d.b[1], z(d.b)],
        getColor: (d) => [...d.color, 255], getWidth: 6, widthMinPixels: 4, updateTriggers: { getSourcePosition: exag, getTargetPosition: exag } }),
    ];
    if (sel != null) {
      L.push(new ScatterplotLayer({ id: 'marker', data: [pts[sel]], getPosition: (p) => [p[0], p[1], z(p)], getRadius: 9, radiusUnits: 'pixels',
        getFillColor: [255, 255, 255], getLineColor: [0, 0, 0], stroked: true, lineWidthMinPixels: 2, updateTriggers: { getPosition: exag } }));
    }
    return L;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segs, exag, sel, pts]);

  useEffect(() => {
    const spanXY = Math.max(extent.x[1] - extent.x[0], extent.y[1] - extent.y[0], 1);
    const span = Math.max(spanXY, (maxAlt - minAlt) * 2);
    const cx = (extent.x[0] + extent.x[1]) / 2, cy = (extent.y[0] + extent.y[1]) / 2;
    const deck = new Deck({
      parent: parent.current,
      views: new OrbitView({ orbitAxis: 'Z', fov: 40 }),
      initialViewState: { target: [cx, cy, ((maxAlt - minAlt) * 2) / 2], zoom: Math.log2(600 / span), rotationX: 50, rotationOrbit: -30, minZoom: -8, maxZoom: 6 },
      controller: true,
      getCursor: ({ isHovering }) => (isHovering ? 'pointer' : 'grab'),
      onClick: (info) => { if (info.layer?.id === 'route') setSel(info.object.i); },
    });
    deckRef.current = deck;
    return () => { deck.finalize(); deckRef.current = null; };
  }, [extent, minAlt, maxAlt]);

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
          <input type="range" min="1" max="8" step="0.5" value={exag} onChange={(e) => setExag(+e.target.value)} style={{ width: '100%' }} />
        </label>
        <div style={{ color: '#666' }}>Drag to rotate · scroll to zoom · right-drag to pan</div>
      </div>
    </div>
  );
}

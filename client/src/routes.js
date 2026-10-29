const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;

export function haversine([lat1, lon1], [lat2, lon2]) {
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Evenly spaced points along a polyline (by distance).
export function resample(pts, n) {
  if (pts.length < 2) return pts;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversine(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1] || 1;
  const out = [];
  let j = 1;
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    while (j < pts.length - 1 && cum[j] < target) j++;
    const span = cum[j] - cum[j - 1] || 1;
    const f = Math.min(1, Math.max(0, (target - cum[j - 1]) / span));
    out.push([pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * f, pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * f]);
  }
  return out;
}

// Points every ~stepM metres along a polyline, for heatmap density.
export function densify(pts, stepM = 25) {
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const d = haversine(pts[i - 1], pts[i]);
    const steps = Math.max(1, Math.round(d / stepM));
    for (let s = 0; s < steps; s++) {
      const f = s / steps;
      out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f]);
    }
  }
  if (pts.length) out.push(pts[pts.length - 1]);
  return out;
}

const meanMinDist = (a, b) => a.reduce((s, p) => s + Math.min(...b.map((q) => haversine(p, q))), 0) / a.length;

// Symmetric mean nearest-point distance: ignores direction and start point.
function routeDistance(a, b) {
  return Math.max(meanMinDist(a, b), meanMinDist(b, a));
}

/**
 * Group runs that follow (nearly) the same path.
 * runs: [{ id, date, distance, elevationGain, pts }]. Returns groups with >= minRuns, biggest first.
 */
export function groupRoutes(runs, { minRuns = 5, tolerance = 60, lengthTolerance = 0.1, samples = 40 } = {}) {
  const groups = [];
  const sorted = [...runs].sort((a, b) => new Date(b.date) - new Date(a.date));
  for (const run of sorted) {
    if (run.pts.length < 2 || run.distance < 500) continue;
    const sig = resample(run.pts, samples);
    const group = groups.find(
      (g) => Math.abs(run.distance - g.distance) / g.distance < lengthTolerance && routeDistance(sig, g.sig) < tolerance,
    );
    if (group) group.runs.push(run);
    else groups.push({ sig, distance: run.distance, runs: [run] });
  }
  return groups
    .filter((g) => g.runs.length >= minRuns)
    .map((g, i) => ({
      id: g.runs[0].id, // latest run represents the route
      runs: g.runs,
      count: g.runs.length,
      distance: g.runs.reduce((s, r) => s + r.distance, 0) / g.runs.length,
      elevationGain: g.runs.reduce((s, r) => s + r.elevationGain, 0) / g.runs.length,
      name: g.runs[0].name,
    }))
    .sort((a, b) => b.count - a.count);
}

import { ramp } from './colors.js';

// Smoothed altitude and a 0..1 colour value per point ('elevation' or 'grade').
export function pointValues({ altitude, distance }, mode) {
  const n = altitude.length;
  const smooth = altitude.map((_, i) => {
    let sum = 0, c = 0;
    for (let j = Math.max(0, i - 3); j <= Math.min(n - 1, i + 3); j++) { sum += altitude[j]; c++; }
    return sum / c;
  });
  const lo = Math.min(...smooth), hi = Math.max(...smooth);
  const t = smooth.map((a, i) => {
    if (mode !== 'grade') return (a - lo) / ((hi - lo) || 1);
    if (i === 0) return 0.5;
    const dd = distance[i] - distance[i - 1];
    const grade = dd > 0 ? ((a - smooth[i - 1]) / dd) * 100 : 0;
    return (Math.max(-15, Math.min(15, grade)) + 15) / 30;
  });
  return { t, colors: t.map(ramp) };
}

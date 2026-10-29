// Total gain/descent from an altitude stream. Smooths GPS/barometer noise, then only counts
// movement once it exceeds `threshold` metres from the last counted point.
export function elevationStats(altitude, threshold = 3) {
  const n = altitude.length;
  if (n < 2) return { gain: 0, descent: 0 };
  const smooth = altitude.map((_, i) => {
    let sum = 0, c = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) { sum += altitude[j]; c++; }
    return sum / c;
  });
  let ref = smooth[0], gain = 0, descent = 0;
  for (const a of smooth) {
    if (a - ref >= threshold) { gain += a - ref; ref = a; }
    else if (ref - a >= threshold) { descent += ref - a; ref = a; }
  }
  return { gain: Math.round(gain), descent: Math.round(descent) };
}

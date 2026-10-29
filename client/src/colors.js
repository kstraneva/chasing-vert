// Blue (low/downhill) -> green -> yellow -> red (high/uphill)
const STOPS = [[49, 54, 149], [69, 117, 180], [102, 189, 99], [254, 224, 139], [244, 109, 67], [165, 0, 38]];

export function ramp(t) {
  const x = Math.min(1, Math.max(0, t)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(x));
  const f = x - i;
  const c = STOPS[i].map((v, k) => Math.round(v + (STOPS[i + 1][k] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export const RAMP_CSS = `linear-gradient(to right, ${[0, 0.2, 0.4, 0.6, 0.8, 1].map(ramp).join(',')})`;

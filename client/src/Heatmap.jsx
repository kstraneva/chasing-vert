import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.heat';
import { densify } from './routes.js';

export default function Heatmap({ routes }) {
  const map = useMap();
  useEffect(() => {
    const points = routes.flatMap((pts) => densify(pts).map(([lat, lng]) => [lat, lng, 1]));
    const layer = L.heatLayer(points, {
      radius: 6, blur: 8, minOpacity: 0.35, max: 12,
      gradient: { 0.2: '#2b83ba', 0.45: '#abdda4', 0.65: '#ffffbf', 0.85: '#fdae61', 1: '#d7191c' },
    }).addTo(map);
    return () => { map.removeLayer(layer); };
  }, [routes, map]);
  return null;
}

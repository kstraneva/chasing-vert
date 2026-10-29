import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { elevationStats } from './elevation.js';

const { STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, PORT = 3001, CLIENT_URL = 'http://localhost:5173' } = process.env;
const DATA_DIR = path.resolve('.data');
const TOKEN_FILE = path.join(DATA_DIR, 'tokens.json');
const ACTIVITIES_FILE = path.join(DATA_DIR, 'activities.v2.json');
const STREAMS_DIR = path.join(DATA_DIR, 'streams');
// Strava sport types we keep, grouped into the families shown in the UI.
const SPORT_GROUPS = {
  run: ['Run', 'TrailRun'],
  ride: ['Ride', 'MountainBikeRide', 'GravelRide', 'EBikeRide', 'EMountainBikeRide', 'Handcycle'],
  ski: ['AlpineSki', 'BackcountrySki', 'NordicSki'],
};
const sportGroup = (a) => {
  const t = a.sport_type || a.type;
  return Object.keys(SPORT_GROUPS).find((g) => SPORT_GROUPS[g].includes(t)) || null;
};
const REDIRECT_URI = `http://localhost:${PORT}/auth/callback`;

await fs.mkdir(STREAMS_DIR, { recursive: true });

const readJson = async (file) => {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
};

async function tokenRequest(params) {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    body: new URLSearchParams({ client_id: STRAVA_CLIENT_ID, client_secret: STRAVA_CLIENT_SECRET, ...params }),
  });
  if (!res.ok) {
    const detail = await res.text();
    console.error(`Strava token error ${res.status}: ${detail}`);
    throw new Error(`Strava token error ${res.status}: ${detail}`);
  }
  const tokens = await res.json();
  await fs.writeFile(TOKEN_FILE, JSON.stringify(tokens), { mode: 0o600 });
  return tokens;
}

async function accessToken() {
  let tokens = await readJson(TOKEN_FILE);
  if (!tokens) return null;
  if (tokens.expires_at < Date.now() / 1000 + 60) {
    tokens = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
  }
  return tokens.access_token;
}

async function strava(pathname, token) {
  const res = await fetch(`https://www.strava.com/api/v3${pathname}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw Object.assign(new Error(`Strava API ${res.status}`), { status: res.status });
  return res.json();
}

const app = express();

app.get('/auth/login', (_req, res) => {
  const q = new URLSearchParams({
    client_id: STRAVA_CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code',
    approval_prompt: 'auto', scope: 'read,activity:read_all',
  });
  res.redirect(`https://www.strava.com/oauth/authorize?${q}`);
});

app.get('/auth/callback', async (req, res) => {
  try {
    await tokenRequest({ code: req.query.code, grant_type: 'authorization_code' });
    res.redirect(CLIENT_URL);
  } catch (e) { res.status(500).send(e.message); }
});

app.get('/api/status', async (_req, res) => res.json({ authed: !!(await readJson(TOKEN_FILE)) }));

// Runs, rides and skis; cached on disk. Pass ?refresh=1 to re-fetch from Strava.
app.get('/api/activities', async (req, res) => {
  try {
    if (!req.query.refresh) {
      const cached = await readJson(ACTIVITIES_FILE);
      if (cached) return res.json(cached);
    }
    const token = await accessToken();
    if (!token) return res.status(401).json({ error: 'not authenticated' });
    const activities = [];
    for (let page = 1; ; page++) {
      const batch = await strava(`/athlete/activities?per_page=200&page=${page}`, token);
      activities.push(...batch.filter((a) => sportGroup(a)));
      if (batch.length < 200) break;
    }
    const slim = activities.map((a) => ({
      id: a.id, name: a.name, sport: sportGroup(a), sportType: a.sport_type || a.type, date: a.start_date_local, distance: a.distance,
      movingTime: a.moving_time, elevationGain: a.total_elevation_gain,
      polyline: a.map?.summary_polyline || null,
    }));
    await fs.writeFile(ACTIVITIES_FILE, JSON.stringify(slim));
    res.json(slim);
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// Per-point streams for one run (cached).
app.get('/api/activities/:id/streams', async (req, res) => {
  try {
    const id = req.params.id.replace(/\D/g, '');
    const file = path.join(STREAMS_DIR, `${id}.json`);
    const cached = await readJson(file);
    if (cached) return res.json({ ...cached, stats: elevationStats(cached.altitude) });
    const token = await accessToken();
    if (!token) return res.status(401).json({ error: 'not authenticated' });
    const s = await strava(`/activities/${id}/streams?keys=latlng,altitude,distance&key_by_type=true`, token);
    const out = { latlng: s.latlng?.data || [], altitude: s.altitude?.data || [], distance: s.distance?.data || [] };
    await fs.writeFile(file, JSON.stringify(out));
    res.json({ ...out, stats: elevationStats(out.altitude) });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// Gain/descent for every activity whose streams are already cached.
app.get('/api/stats', async (_req, res) => {
  const out = {};
  for (const f of await fs.readdir(STREAMS_DIR)) {
    const s = await readJson(path.join(STREAMS_DIR, f));
    if (s?.altitude) out[f.replace('.json', '')] = elevationStats(s.altitude);
  }
  res.json(out);
});

app.listen(PORT, () => console.log(`chasingVert server on :${PORT}`));

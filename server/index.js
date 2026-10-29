import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';

const { STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, PORT = 3001, CLIENT_URL = 'http://localhost:5173' } = process.env;
const DATA_DIR = path.resolve('.data');
const TOKEN_FILE = path.join(DATA_DIR, 'tokens.json');
const ACTIVITIES_FILE = path.join(DATA_DIR, 'activities.json');
const STREAMS_DIR = path.join(DATA_DIR, 'streams');
const REDIRECT_URI = `http://localhost:${PORT}/auth/callback`;

await fs.mkdir(STREAMS_DIR, { recursive: true });

const readJson = async (file) => {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
};

async function tokenRequest(params) {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: STRAVA_CLIENT_ID, client_secret: STRAVA_CLIENT_SECRET, ...params }),
  });
  if (!res.ok) throw new Error(`Strava token error ${res.status}`);
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

// Runs only; cached on disk. Pass ?refresh=1 to re-fetch from Strava.
app.get('/api/activities', async (req, res) => {
  try {
    if (!req.query.refresh) {
      const cached = await readJson(ACTIVITIES_FILE);
      if (cached) return res.json(cached);
    }
    const token = await accessToken();
    if (!token) return res.status(401).json({ error: 'not authenticated' });
    const runs = [];
    for (let page = 1; ; page++) {
      const batch = await strava(`/athlete/activities?per_page=200&page=${page}`, token);
      runs.push(...batch.filter((a) => a.type === 'Run' || a.sport_type === 'Run' || a.sport_type === 'TrailRun'));
      if (batch.length < 200) break;
    }
    const slim = runs.map((a) => ({
      id: a.id, name: a.name, date: a.start_date_local, distance: a.distance,
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
    if (cached) return res.json(cached);
    const token = await accessToken();
    if (!token) return res.status(401).json({ error: 'not authenticated' });
    const s = await strava(`/activities/${id}/streams?keys=latlng,altitude,distance&key_by_type=true`, token);
    const out = { latlng: s.latlng?.data || [], altitude: s.altitude?.data || [], distance: s.distance?.data || [] };
    await fs.writeFile(file, JSON.stringify(out));
    res.json(out);
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log(`chasingVert server on :${PORT}`));

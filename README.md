# chasingVert

Visualize your Strava runs with elevation: an all-runs heatmap with a vert ranking, and per-run routes colored by elevation or grade.

## Setup
1. Create a Strava API app at https://www.strava.com/settings/api with **Authorization Callback Domain** = `localhost`.
2. `cp .env.example .env` and fill in `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET`.
3. `npm install && npm run dev`, then open http://localhost:5173 and click **Connect with Strava**.

Tokens and cached activity data live in `.data/` (git-ignored). Delete `.data/activities.json` to re-sync.

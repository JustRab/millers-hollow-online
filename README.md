# Millers Hollow Online

A real-time multiplayer web adaptation of *The Werewolves of Millers Hollow*, built with React, Vite, TypeScript, and Socket.io.

## Features

- 9 roles: Villager, Werewolf, Seer, Doctor, Hunter, Dog, Girl of the Night, Cupid, Maid
- Real-time multiplayer via Socket.io with isolated rooms
- Night/day phase cycle with a countdown timer
- Host controls: kick players, lock the room, pick role presets
- Werewolf pack chat during night phase
- Session tokens for rejoin recovery
- Post-game summary with vote history and timeline
- Responsive layout for desktop and mobile

## Run locally

Requires Node.js 20+.

```bash
npm install
npm run dev:full
```

Open `http://localhost:5173`. The Vite dev server and the Socket.io room server (port `3001`) both start. Open the URL in two browser tabs to test shared state.

To test on other devices on the same network, replace `localhost` with your machine's local IP address (e.g. `http://192.168.x.x:5173`).

For separate processes:

```bash
npm run dev:server   # terminal 1 – room server on :3001
npm run dev          # terminal 2 – Vite on :5173
```

## Production build

```bash
npm run build
npm start
```

The combined server is available at `http://localhost:3001`. The health check endpoint is `/health`.

## Deployment

The repository includes a `Dockerfile` and `render.yaml` for one-click deployment on [Render](https://render.com):

1. Fork or clone this repository.
2. Create a Render account and choose **New → Blueprint**.
3. Connect your repository and deploy.

Render builds the Docker image, starts the server, and provides a public HTTPS URL. Room state is in-memory, so a server restart clears active games.

Any other Node-compatible host (Railway, Heroku, a VPS with Docker) works equally well — see `DEPLOYMENT.md` for details.

## Room links

Each room is identified by a `room` query parameter. Visiting the root URL creates or joins the default room. Use invite links like `https://your-host.example.com?room=FROST-42` to start named rooms. The copy button next to the room code copies the full invite link.

## License

MIT

# Millers Hollow Online

A responsive React/Vite prototype for a remote-friendly version of *The Werewolves of Millers Hollow*.

## Current playable slice

- Night and day phase switching
- Private Seer role card and role reveal action
- Living/dead player roster with selectable targets
- Invite-only room code UI
- Village chat composer and message feed
- Responsive layout for desktop and mobile screens

## Run locally

Install Node.js 20+ first, then run the full app with one command:

```bash
npm install
npm run dev:full
```

Open `http://localhost:5173`. The Vite UI and the realtime room server will both start. Open the address in two browser tabs to test shared chat and phase changes. The room server runs on port `3001`.

To play with people on the same Wi-Fi, find this PC's local IPv4 address with `ipconfig`, then have them open `http://YOUR-IP:5173` on their devices. For example: `http://192.168.1.42:5173`. Windows Firewall may ask to allow Node.js on private networks; allow it only if this is a trusted network.

The room-code copy buttons copy a complete invite link. On the hosted Render URL, click the copy button beside the room code and send that link to your players.

For separate processes, use `npm run dev:server` and `npm run dev` in two terminals.

For a production-style local run, build and start the single combined server:

```bash
npm run build
npm start
```

The app is served at `http://localhost:3001` and its health check is `http://localhost:3001/health`. This is the shape to deploy to a Node-compatible host.

## Public deployment

This repository includes a `Dockerfile` and `render.yaml` for deployment on Render. Create a Render account, choose **New > Blueprint**, connect this repository, and deploy. Render will build the container, start the combined app, and provide a public HTTPS URL. The current server keeps one development room in memory, so it is suitable for a first hosted playtest but not yet for multiple independent rooms or restart-safe games.

## Multiplayer next step

Rooms are now isolated by the `room` URL parameter. A direct visit uses `MILL-7Q2`; an invite link such as `https://your-game.onrender.com?room=FROST-42` creates or joins that room. Chat, roles, votes, phase timers, and rematches stay inside their room. Room state is still in memory, so a server restart clears active games.

## Publish updates

After making changes, run this in PowerShell:

```powershell
$env:Path = "$env:LOCALAPPDATA\Programs\nodejs;$env:Path"
npm run build
git add .
git commit -m "Describe the change"
git push
```

Render automatically redeploys after the push. Wait for deployment to finish, then refresh the public URL with `Ctrl+F5`.

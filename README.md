# Splat Racers — PlayCanvas / Ammo racing

Source and browser deployment: https://blumsall-sys.github.io/splat-racers/

This project uses **one gameplay and physics implementation**, centered on `src/v14/main.js`, PlayCanvas 2.23 and native Bullet/Ammo `btRaycastVehicle` karts. The Blender asset pack provides the static road collision GLB, guardrails, track route, optional SOG, and vehicle asset references.

## Launch modes

- **One-player and two-player local split-screen:** [main game](https://blumsall-sys.github.io/splat-racers/). Existing local handling, boost, hop, AI and collision code is retained.
- **Online racing (up to 4 players, optionally with NPCs):** [online room](https://blumsall-sys.github.io/splat-racers/LAN.html?online). Select **Create room** to open the **native Ammo host**, or enter an invitation code to join an existing room.
- **Native online host directly:** [create an Ammo room](https://blumsall-sys.github.io/splat-racers/?online-host=1).
- **Local development server:** `npm install && npm run setup:ammo && npm run dev`. Visit `http://localhost:5173/` or `http://localhost:5173/?online-host=1`. Use `npm run lan` to expose this same Vite app on the LAN. It does **not** start a second physics server.

## Online authority

The host opens the *same* game entry point as local racing, initializes the same Ammo WASM module, builds the static road triangle mesh from `collision.glb`, and creates the same `makeKart` / `btRaycastVehicle` chassis. The shared `update(dt)` game loop applies incoming controls through `driveRaycastVehicle`, uses the existing NPC controllers, checks signed lap/flight gates and handles recovery. Host snapshots contain world-space positions and rotations read from actual Ammo-powered PlayCanvas entities.

Guests run the browser **visualization** page `LAN.html`, send throttle/steering/boost/flight controls and interpolate host-authored snapshots. Guests do not run a separate vehicle simulator, estimate road height, author physical poses or award laps. Only the host is authoritative. The native host cannot migrate mid-race; closing its tab ends the room.

**The previous simplified network vehicle/road/kinematic simulation has been retired.** No independent road-surface function runs online, and the old standalone LAN physics endpoint has been removed. PeerJS/WebRTC supplies room discovery and peer data channels, not physics. Without a TURN relay, restrictive NATs may still prevent direct remote connections. Genuine two-device driving, GPU/Ammo contact, and unstable-network behavior require live browser tests beyond the automated test suite.

## Two-device online test

1. Open the online page in Chrome, choose **Create room**, then wait for the native game and host panel.
2. Create a room, copy the invitation URL and send it to a second device or different network.
3. Guest selects Kart/Hover/Drone and presses **READY**. Host chooses vehicle, laps, speed, NPC count and difficulty, then presses **READY** and **START RACE**. Up to four racers total.
4. Verify both karts traverse the full banked road and climb without clipping. Check checkpoints and result match across screens. Test boost/hop, kart contacts and off-track recovery.
5. Close the host to verify guests see a disconnect notice; reconnect with a fresh room to retest.

## Setup, validation and asset workflow

From repository root:

```bash
npm install
npm run setup:ammo
npm test
npm run validate
npm run collisions:check
npm run assets:sog
npm run dev
npm run build
```

The Blender add-on is in `blender_addon/lab5_splat_packager/`. Keep original `.blend`, SOG and collision/GLB assets backed up. The source has `assets/asset-pack.json` and track metadata. Use the in-game Settings & Controls screen for keyboard, gamepad and flight mappings. Debug the local/host runtime with `?debug=1` and `window.__LAB5_RACE_V14.status()`.

GitHub Pages deployment runs tests, asset checks, Vite build and deployed Pages artifact smoke checks. Only a completed successful Pages workflow confirms publication.

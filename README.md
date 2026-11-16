# Splat Racers v2.3.0 — NPC Racing Reliability Update

Browser game: **PlayCanvas WebGL 2 + Ammo/Bullet**. Procedural scene and vehicle exporter: **LAB5 Blender Add-on v2.3.0**. Local game: 1–2 people + up to 3 NPCs (4 total). The experimental LAN mode is included but continues to use a simplified server simulation—not full Ammo race physics.

This release rebuilds drone/hovercraft navigation for artist-authored, oriented 3D flight rings, improves **all three kart NPC difficulty levels**, and preserves the local race, boost, hop, countdown, roster, materials, track, collision and SOG workflows. Read [`docs/V230_FLIGHT_NPC_REBUILD_QA.md`](docs/V230_FLIGHT_NPC_REBUILD_QA.md) for details and limitations.

## Start on Windows

1. **Back up** your working `.blend`, `.sog` and Blender-exported game assets. Extract this complete ZIP into a **new folder**, not over v2.2.0.
2. Install the **separate** `LAB5_Splat_Racers_Blender_v2.3.0.zip` from Blender Preferences → Add-ons → Install from Disk. The add-on's Python source is also available under `blender_addon/` for inspection. Point its **Game root** to this new game folder.
3. In Blender, keep your `TRACK_Centerline`, road/wall geometry, `AIR_OFFSET_XX` ring edits and original splat. Run **Validate Race Collections**, fix any ring warnings that affect your intended racing line, then **Export Asset Pack to Game**. You can alternatively use `IMPORT_EXISTING_PACK_WINDOWS.bat` to migrate the old assets, but that won't reposition existing rings or re-export changed geometry.
4. Run `CHECK_ASSETS_WINDOWS.bat`, `CHECK_FLIGHT_ROUTE_WINDOWS.bat`, then `START_WINDOWS.bat`. Start at `http://localhost:5173/` (diagnostics: `http://localhost:5173/?debug=1`). The launcher installs npm packages and stages Ammo on the first run.
5. First test **1 player + 3 NPCs, Medium, 1 lap, 1× speed**, then Hard and 2× speed. Test at least one drone and one hovercraft rival against a kart. Turn and tilt a ring and confirm all vehicles cross from the required side.

The **bundled sample pack has no SOG** (`"splat": {}`). It contains minimal road and collider GLBs solely to exercise the browser runtime. Your working Gaussian splat, customized GLBs, textures and `.blend` are **not** in this source release.

## Testing / production build

From a terminal in the game folder:

```bash
npm install
npm run setup:ammo
npm test
npm run validate
npm run bench:air
npm run bench:flight-force
npm run bench:npc
npm run flight:check
npm run dev
npm run build
```

Tests requiring Blender UI, Chrome GPU rendering or **actual PlayCanvas/Ammo collisions** must be run locally. The flight-force benchmark is a controller-response simulation; it is **not** a substitute for a complete game race. `npm run build` requires installed Vite dependencies.

### NPC debugging on your custom circuit

Open Chrome DevTools (F12) and run:

```js
window.__LAB5_RACE_V14.status().npcStatus
```

This provides each NPC's vehicle type, required checkpoint, navigation phase, planned speed, altitude target, time on gate, reapproach count and rescue count. Compare that information with the on-screen highlighted ring before revising Blender rings.

## Controls and project boundaries

Use the in-game **Settings & Controls** screen for P1/P2 keyboard and gamepad mappings. The game retains human hop/ascend/descend/boost commands; NPC altitude control does **not** change these bindings. The Blender exporter still creates GLB visuals/colliders, SOG reference, lights, and the shared 3D ring route. The network mode remains experimental and intentionally separate from local PlayCanvas physics.

A few older physics and driver modules remain in `src/` because the legacy regression tests and drive-lab use them. They are **not** the live PlayCanvas gameplay entry point; `index.html` runs `src/v14/main.js`. Historical documentation and prior-version installer duplicates are excluded from this release.


## Multiplayer test routes (November 16, 2026)

- **Local, one or two players on the same device:** https://blumsall-sys.github.io/splat-racers/
- **Online room, up to four people on different devices:** https://blumsall-sys.github.io/splat-racers/LAN.html?online
- **Self-hosted LAN, up to four people on the same network:** Run `npm install`, then `npm run lan` on the host PC. Open `http://localhost:3000/LAN.html` there and `http://HOST_LAN_IP:3000/LAN.html` on each other machine. Permit TCP port 3000 through the host firewall. This is *not* the GitHub Pages LAN URL: the Node server supplies the local API.

### Quick online test

1. On the first device, open the **online** link and choose **Create room**; wait for your player ID and copy the ten-character invitation link. Keep the host's tab in the foreground.
2. On a second device (ideally a different network, e.g. mobile cellular), open the shared link, enter a name and **JOIN ROOM**. Add a third/fourth device if available. Each participant selects Kart, Hovercraft or Drone and presses **READY**.
3. The host selects 1 lap, 1× pace, and a number of NPCs that keeps the *total* racer count at four or fewer; host also presses **READY**, then **START NETWORK RACE**.
4. Confirm that all devices show the same countdown, everyone can steer and accelerate, position updates and checkpoints are synchronized, and the winning order/results appear. Only the host can return everyone to the lobby.
5. Repeat with one device on another ISP/cellular connection and with the host closing the tab. A closed host should disconnect guests and show a message; reopen and create a fresh code to play again.

**Current networking boundary:** Online rooms use browser-hosted PeerJS/WebRTC data channels and the public PeerJS signaling service, not a dedicated hosted race server. A direct WebRTC connection can fail on restrictive NATs or corporate/firewalled networks because a TURN relay is not provisioned. The LAN and online modes run a simplified host-authoritative kinematic simulation, not the local game's full PlayCanvas/Ammo raycast physics. Neither automated unit tests nor GitHub Pages deployment guarantees real-world WebRTC interoperability, frame rate or 3D rendering; those still need manual multi-device tests.

GitHub Actions checks source tests, asset validation, and the built Pages HTML/asset paths. A test failure prevents deployment.

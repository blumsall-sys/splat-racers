# Splat Racers v2.3.0 — NPC Navigation Rebuild and Test Guide

## Observed problem

In a real SOG/GLB level, hovercrafts and drones can slow near a checkpoint, repeatedly climb/jump, turn in circles, and fail to cross later rings. v2.2.0's synthetic NPC smoke tests could complete because they used idealized vertical velocity and yaw; **those tests did not exercise the actual force-based altitude response or repeated hover impulses**. Hard AI also applied throttle cutoffs around corners, limiting competitive pace.

## Changes in the local PlayCanvas game

- **Directional gate guidance:** entry-side staging → alignment → committed crossing. Planes, radius and forward normals come from the Blender asset pack and are never moved by the AI. Only the existing signed 3D intersection test grants a checkpoint.
- **True 3D approach:** alignment uses the actual ring plane, including artist-authored X/Y tilts; different NPCs have small lateral lane offsets so they don't all aim at one point.
- **Controlled altitude:** flying NPC input provides `npcAltitudeTarget` to the physical Ammo flight controller. Drones use a damped target vertical velocity; hovercraft use their existing force-based world-height hold. The human hovercraft retains its repeatable, impulse-driven jump/hop. No position snaps occur in normal driving.
- **Decisive throttle:** Easy, Medium and Hard target progressively faster cruising speeds and use stronger forward thrust in clear corridors; they no longer almost stop in the centre of the required ring.
- **Course-aware pace:** a 2×/2.5× menu setting does not obligate an NPC to attempt impossible 90-degree turns between rings only 15–20 metres apart. Short gate spacing imposes local speed limits, while long legs permit the multiplier. Predictive steering accounts for lateral momentum and upcoming turn angles.
- **NPC collision sensing:** forward/side rays consider P1–P4, walls, dynamic props and proxy obstacles. Nearby racers cause the controller to leave passing space and yield when necessary. All collisions remain physical.
- **Stall detection and recovery:** an escape attempt occurs after repeated loss of progress; the last-resort reset selects an unobstructed entry position **behind the current required gate**, preserving previous lap progress and resetting the crossing sample to exclude teleports. This is a fallback, not a replacement for driving.
- **Kart AI:** Easy, Medium and Hard now have higher cruise and throttle targets (7.2, 9.7 and 12.3 m/s before race multipliers); curvature-based braking, traffic yielding and physical reverse manoeuvres are retained.

## Blender add-on v2.3.0

The add-on retains the same `TRACK_Centerline`, `AIR_ANCHOR_XX`, `AIR_OFFSET_XX`, glass/PBR materials, SOG reference, dummy collision mesh and exported asset-pack contract. **Validate Race Collections** adds non-destructive warnings for rings too close together, abrupt facing changes in tight spacing and steep altitude jumps. These warnings do not block artistic authoring or reposition any manually edited ring.

## Verification executed on source

- 293 Node regression tests, including 7 new flight-navigation and actual-flight-controller contract checks, passed.
- 12 flight **force-response surrogate** cases: 8 ordered, elevated, rotated gates per run × hovercraft/drone × Easy/Medium/Hard × 1×/2×. All 12 completed without requesting an emergency reset; the surrogate enforces the actual flight controller's acceleration, yaw-rate and vertical-response limits, but does not simulate 3D Ammo collision contacts.
- Existing road and 3-gate flight benchmarks remain available. `npm run validate` checks the pack contract and GLBs; `npm run flight:check` checks gate order/geometry.
- The package source has no video uploads, large SOG assets, installed `node_modules`, generated `dist`, caches, historical manuals, or prior-version add-on archives.

## Required live QA on the customized level

1. Run one human against three mixed NPCs (including at least a hovercraft and drone) for three full laps on Easy, Medium and Hard. Record each class's finish time, ring misses and any auto-rescues.
2. Repeat at 2× speed; on tight rings the AI should slow **before** the corner, but accelerate strongly on open stretches.
3. Test a tall ring followed by a low ring. Both aircraft should stabilize at the new altitude without repeated upward impulse hopping or twisting.
4. Rotate a ring 45–90 degrees in Blender; validate/export the scene; confirm forward crossing only.
5. Add a static crate before an entry ring and run two flying NPCs nearby. Verify sensible yielding, safe overtaking or recovery without invalid gate credit.
6. Re-test kart tires and road contact, all human controls, SOG alignment, materials, countdown, finishes, split-screen HUD and previous lap count on respawn.

The experimental LAN server remains on its previous simplified physics and is **not** included in flight NPC parity claims. This build also needs a live Chrome GPU/Ammo and Blender GUI smoke test before it should be described as release-ready for all authored levels.

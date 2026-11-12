# Orbit

**A library for the games on your PC.**

Orbit is a Windows/Linux desktop app that launches installed games, tracks how
long they are actually played, and shows where disk space went. It is a personal
tool: fast to open, quiet while a game runs, and honest about what it knows.

## Who it is for

One player, on their own machine, with a library in the tens or hundreds. They
want the thing they already own to open faster than Steam, and they want a
record of what they played that belongs to them — not to a storefront.

## The job, in order

1. **Find the game and press Play.** The library is the front door.
2. **Know what to play next.** Backlog, completion estimates, recent sessions.
3. **Keep an honest record.** Sessions, journal entries, achievements, saves.
4. **Keep the disk under control.** Sizes, drives, and safe moves.

## Product truth that must survive any redesign

- Sessions are real: a game that closes closes its session. Nothing runs forever.
- Everything is local. No account, no API key, no telemetry. `orbit.db` and
  `settings.json` are the whole state and can be backed up or deleted.
- Metadata is a bonus, never a requirement. A game added offline still works and
  is filled in quietly later.
- The player owns the appearance: nine built-in themes, custom themes, six font
  stacks, cover scale, tab order, filters. All of it is local and importable.
- TV mode is a different room: fullscreen, controller-first, artwork-led.
- Linux is a first-class target with deliberate performance fallbacks (no glass
  blur, no star field, no hero blur).
- The app is keyboard- and controller-navigable, with visible focus rings and
  reduced-motion support.

## Surfaces

| Surface | Mode | Success looks like |
| --- | --- | --- |
| Library | Operate | Find a game, understand its state, launch it |
| Game detail | Operate | Decide, launch, or correct the record |
| Sessions / Journal | Operate | Read and correct history quickly |
| Backlog | Operate | Choose what to play next |
| Storage | Operate | See what is big and move it safely |
| Settings / Themes | Operate | Change appearance without hunting |
| TV mode | Experience | Pick a game from a sofa without reading chrome |
| Startup / empty states | Operate | Arrive, understand, act |

## Design intent

Orbit should feel like a small observatory for a personal collection, not a
storefront and not a dashboard template. The library is a system of bodies; the
selected game is the one being observed. The interface is dark, precise, warm at
the point of action, and quiet everywhere else.

The reference point is Heronite's artwork-led focus view: the selected game's art
lights the room, the library stays visible beside it, and details are read in a
calm column. Orbit's own identity comes from celestial mechanics — orbital
lines, telemetry, grouped bodies — not from copying Heronite's chrome.

## Non-goals

- Storefront promotion, recommendations, social features, accounts.
- Dense dashboards for their own sake.
- Decorative motion that competes with artwork.
- A visual language that breaks the theme system or custom themes.

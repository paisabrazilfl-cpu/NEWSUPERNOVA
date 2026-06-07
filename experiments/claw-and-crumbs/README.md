# Claw & Crumbs 🐭🧀

An original arcade **platform-chase** game. Milo the House Mouse must climb a
rooftop-kitchen tower to the **golden cheese** while **Max the Alley Cat** hurls
yarn balls, rolling cheese wheels, and pots & pans down the girders.

Built as a smoke test of the "find a Donkey-Kong-style repo and reskin it into an
original, legally-safe cat-and-mouse game" task.

## How to run

It's a single static file — **no build, no dependencies, no assets.**

```bash
# any static server, e.g.
npx serve experiments/claw-and-crumbs
# or just open the file directly:
open experiments/claw-and-crumbs/index.html
```

Then open the served URL in a browser.

## Controls

| Action | Keys |
| ------ | ---- |
| Move   | ← → or A D |
| Jump   | Space |
| Climb ladders | ↑ ↓ or W S |
| Start / Restart | Enter |
| Touch  | tap left/right half to move, tap top to jump |

## Research & source

Real GitHub search (via the GitHub API) was run for Donkey-Kong-style /
barrel-platformer / HTML5 / Phaser / Canvas games. **Almost every clone on GitHub
ships with *no license*** (= all-rights-reserved, not legally reusable). The only
clearly permissive, runnable candidate found was:

- **`leandrocurioso/barrel-jumper-html5-game`** — **MIT License** (© 2018 Leandro
  Curioso). Verified from the repo's `LICENSE` file. MIT permits modification and
  commercial reuse with attribution.
  - Stack: Phaser 3.18 + Webpack 4 + Gulp + Babel.
  - It was cloned, `npm install`-ed, built (Webpack 4 needs
    `NODE_OPTIONS=--openssl-legacy-provider` on Node 22), and confirmed running in
    a browser before any work here.

## Relationship to the source (transparency)

This game is an **original, from-scratch implementation**, not a fork of the MIT
repo's Phaser source. That choice was deliberate:

1. **Legal safety** — the original ships PNG sprite assets (a gorilla, a
   Mario-style player). To guarantee *zero* copyrighted assets remain, every
   graphic here is **drawn procedurally in canvas code** — there are **no image,
   sprite, or audio files at all**.
2. **Portability** — no Webpack-4-on-modern-Node toolchain fragility; runs by
   opening one file.

The MIT repo provided the **researched, license-cleared, build-and-run base** and
the *structural* template (platform tower, ladders, top boss hurling hazards that
roll/zig-zag down, climb-to-the-goal objective). Attribution is retained above.

## Changes / what's original here

- **Title & all UI:** "Claw & Crumbs", start / win / lose / HUD screens.
- **Player:** Milo the House Mouse (small, fast) — original code-drawn sprite.
- **Boss/enemy:** Max the Alley Cat — original code-drawn, dramatic, throws hazards.
- **Hazards:** yarn balls, rolling cheese wheels, pots & pans (replacing barrels).
- **Goal:** glowing golden cheese wedge + mouse hole (replacing the rescue target).
- **Mechanics:** walk, gravity/jump, ladder climbing, zig-zag rolling hazards,
  3 lives, scoring, win/lose states, responsive scaling, touch controls.

## Legal note

All names, characters, sprites, UI, and text are **original**. This project uses
**no** copyrighted names or assets (no Donkey Kong, Nintendo, Mario, Tom & Jerry,
Warner Bros., or MGM names/likenesses). Visual style is a generic "classic
slapstick cartoon cat-and-mouse chase." Structural inspiration and the MIT base
repo are credited above.

## Validation (Playwright, headless Chromium)

Verified by automated browser checks (`window.__claw` test hooks + real keyboard
input):

| Check | Result |
| ----- | ------ |
| Canvas / game area appears | ✅ |
| Title screen shows "Claw & Crumbs" | ✅ |
| Enter starts the game (state → playing) | ✅ |
| Move left / right (real arrow-key input) | ✅ |
| Jump (Space → upward velocity) | ✅ |
| Climb ladder (drove to ladder, ↑ → y 568→458) | ✅ |
| Hazards spawn during play | ✅ (3 active) |
| Win state can trigger | ✅ |
| Lose state can trigger | ✅ |
| Console-breaking errors | ✅ none (0) |

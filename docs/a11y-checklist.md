# Accessibility checklist

Scope: the Tier-2 station page (`#/station/<id>`): route planner, step list, floor switcher, map, legend and floor list. Target: WCAG 2.2 AA (CLAUDE.md). CI fails below Lighthouse accessibility 95 or on any serious or critical axe violation.

Status at the end of step 2.5 (2026-10-06): everything automated passes; **the manual screen-reader pass has not been done** (section 4). Do not describe the app as screen-reader tested until it is.

## 1. Automated checks (run on every change)

| What | Where | Result |
|---|---|---|
| axe (WCAG 2.0 to 2.2 A and AA) on the station page with a route and with a step selected, in ja, en, zh-Hant, ja-easy | `e2e/planner-a11y.spec.ts` | no violations |
| axe on the no-route page (麻布十番) in all four languages | same | no violations |
| axe in dark mode, increased contrast, and both | same | no violations |
| axe with best-practice rules (ad hoc, route and selected step) | run by hand | none (47 rules pass) |
| Lighthouse accessibility, home and station page | `pnpm lighthouse` | 100 and 100 (performance 100 and 99) |
| Heading outline never skips a level, with a route and without | `planner-a11y.spec.ts` | pass |
| DOM order: planner controls, status, steps, floor switcher, map, floor list | same | pass |
| Tab order and no keyboard trap (focus leaves the page within 120 stops) | same (desktop) | pass |
| Enter and Space toggle a step; focus ring is at least 2 px; focus stays on the button | same (desktop) | pass |
| Arrow keys change the profile and the route updates | same (desktop) | pass |
| The skip button jumps past the step list to the floor choice | same (desktop) | pass |
| Planner controls (radio rows, selects, step buttons) are at least 44 by 44 px | same | pass |
| The route status is a polite live region and says when there is no route | same | pass |
| The map's own controls and canvas are in the page language | same | pass |

Run them: `cd apps/web && pnpm test`, `PW_CHANNEL=msedge pnpm e2e`, `CHROME_PATH="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" pnpm lighthouse`. If Playwright finds an old server on port 4173 it reuses it and tests a stale build: check `lsof -iTCP:4173 -sTCP:LISTEN` first.

## 2. Reading order (what a screen reader meets, top to bottom)

1. Skip link, then the header (h1, language select).
2. Main: link back to the station list; h2 station name; the tier line; warnings (not verified on site, no step-free route in the data).
3. **Route planner** (h3): direction (radio group), entrance (select), platform (select), how you travel (radio group with a hint read as its description); then the polite status line ("N-step directions are shown" or "No route found").
4. **Directions** (h4): summary (metres, elevator rides); "skip the step list" button; ordered list. Each item is one sentence, then notes (slopes, missing data, floor changes, wide gate), then a "Show on map: step N" toggle button (pressed or not). A note explains that elevators are named by exit or floor.
5. No route: an alert with h4 title, the reason, what is in the way, then h5 "What you can do" and a list.
6. Floor switcher (radio group), the floor status line (polite), the map region (its label names the floor and says the route is a yellow line; the canvas inside is "Operate the map" with zoom buttons and credits), the map key (h2), then the floor list (h2): what is on this floor, as text.

The step list is the text equivalent of the route on the map; the floor list is the text equivalent of the map's contents. The map is never the only way.

## 3. Keyboard walkthrough (desktop)

Expected tab stops at 大門, in order: skip link, language, back link, direction (the selected radio), entrance, platform, how you travel (the selected radio), skip button, 13 step buttons, floor switcher (the selected radio), map canvas, zoom in, zoom out, credits (only with the basemap on), then out of the page.

- Arrow keys move inside a radio group and change the choice; the route updates at once.
- Enter or Space on a step button shows that step (floor, zoom, orange highlight) and presses it; again clears it. Focus stays on the button.
- The skip button puts the focus on the selected floor radio; the next Tab is the map canvas.
- On the map: arrow keys pan, plus and minus zoom.

## 4. Manual screen-reader pass (not done yet)

Do this on a real device before the user tests (step 4.3), and again after the visual design pass (2.11). Tick and date each line; write findings into this file.

macOS Safari with VoiceOver, and iOS Safari with VoiceOver, in Japanese and in English:

- [ ] Rotor headings read as a sensible outline (h1, station, planner, directions, map key, floor list).
- [ ] Each control is announced with its group: "Direction, into the station, radio button, 1 of 2".
- [ ] The travel-how hint is read when the group is entered (it is the group's description).
- [ ] Changing a choice announces "N-step directions are shown" once, not repeatedly.
- [ ] Each step reads naturally as a sentence; the notes follow it; "Show on map: step N, toggle button, not pressed".
- [ ] Pressing a step button announces the new floor ("B3 is shown"); the pressed state is spoken.
- [ ] On first load the floor status may announce the first floor and then the route's start floor (the page opens on B1's data, then moves to the floor where the route starts). Check it is not confusing; if it is, delay the first floor until the route is known.
- [ ] The map region and the canvas inside it are not announced as the same thing twice. Check how much "region inside region" noise there is and whether the canvas should stop being a stop at all.
- [ ] The no-route alert is announced when it appears and its list of alternatives is reachable.
- [ ] Swipe order on iOS follows section 2.
- [ ] Switching language keeps the place on the page and the map labels change.
- [ ] Outage reports (step 2.8, needs Supabase configured): "Report a problem with the elevator in step N, collapsed" is announced; opening it moves to "Not working" inside the group "Is this elevator working?"; Escape returns to the report button.
- [ ] After a report the focus lands on the thank-you (or error) message and it is read once; when the route then changes, "The route changed because outage reports were updated" is read with the step count, not twice.
- [ ] In "Outages at this station", each "Still not working" / "Working again" button is read with the device it is about (its description).
- [ ] Journey planner (step 2.4): "From" and "To" are read as groups; typing a station name lists the matching stations as buttons (with "Routes inside the station" for tier 2); after choosing, the focus is on "Change From" and the choice is read ("From: Daimon Station").
- [ ] "Search addresses and places" reads its status ("Searching…", the result or the failure) once, and the results are reachable as buttons right after it.
- [ ] After "Find routes" the focus moves to "Route options"; "3 route options found" is read once; each option button reads its times and facts and its pressed state.
- [ ] The timeline reads in order: street walk, station (heading, then its steps), train (line, times, where to ride), station. Report buttons inside a journey say which step they belong to (step numbers restart in each station: check this is not confusing).

TalkBack on Android if a device is available.

Also check by hand:

- [ ] Reduced motion: with "reduce motion" on, pressing a step moves the map without animation (the code sets the duration to 0; not observed in a browser yet).
- [ ] 200% and 400% zoom: no horizontal scrolling at 320 CSS px width, nothing cut off.
- [ ] Windows high-contrast or forced-colours mode: radio buttons, focus ring and step buttons stay visible; the route line on the map is separately checked below.
- [ ] Route on the map against the GSI basemap: the yellow line has a black edge (contrast above 3:1 against both the basemap and the floor polygons). Spot check on at least 3 floors.

## 5. Findings and fixes during step 2.5

- **MapLibre labels were English in every language.** The map canvas ("Map") and the zoom buttons ("Zoom in", "Zoom out") ignored the page language, against the no-hard-coded-strings rule. Fixed with MapLibre's `locale` option; the map is rebuilt when the language changes. Also, MapLibre's canvas is a focusable `role="region"` of its own, so it needs a name different from the wrapper's ("Operate the map").
- **13 tab stops before the floor switcher.** A keyboard user had to Tab through every step button to reach the map. Fixed with a "skip the step list" button before the list.
- **The page opens on the floor where the route starts** (the ground at 大門), not on the first floor with a map. Two e2e tests were updated for that.

## 6. Known gaps

- Chinese (zh-Hant) and easy Japanese wording has not been read by a native speaker (see `apps/web/src/i18n/README.md`).
- The 5 routing profiles are named by person type; hints say what each avoids. Whether the names feel respectful needs the user tests.
- The map is visual by nature: route lines and numbered markers have no accessible names. By design the step list carries all the information, and the markers' numbers match the list.
- Colours on the map are placeholders until the visual design pass (2.11); re-run section 1 and the contrast spot checks after it.

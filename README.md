# Crowder Desk

A small desktop widget for Windows. It shows eight cards at a glance:

- **Weather:** current conditions, today's high and low, wind, humidity, sunset time, and the next three days (Open-Meteo, no API key needed).
- **Blog Plan:** your next unchecked tasks with due dates. Tick a box and it's marked done in Blog Plan too.
- **Today's recipe:** one recipe from Crowder Kitchen each day, with your favorites picked more often. "View recipe" opens the whole recipe in its own window. The shuffle button picks another. A recipe shown in the last 14 days isn't picked again unless nothing else fits your section filter.
- **Light:** golden and blue hour for the next morning and evening, a color outlook for the next sunrise or sunset (from the high, mid and low cloud forecast), the moon's phase, rise and set, the next full or new moon, and the best night for stars in the coming week.
- **Shoot Planner:** the best-scoring sunrise, sunset, blue hour or night session at your saved spots over the next day and a half, with its time window, the main reason for the score and any heat, wind or NWS alert; the next three runners-up; and your next planned outing with its packing progress. Scores use the same rules as the Shoot Planner (`src/shootsky.js` is a copy of the planner's `sky.js`). Needs the same sign-in as Blog Plan. **Open** goes to the planner.
- **Quick note:** type a line and press Enter to add it to today's Obsidian daily note (using your Daily Notes folder and date format) or to an inbox note. Notes can be added as timestamped bullets, tasks or plain bullets.
- **Job search:** your open, starred, new and applied counts from the Job Tracker, starred reqs you haven't applied to (with a warning when the 1-month rule will drop them), and follow-ups that are due. Clicking a title opens the posting, and the **Applied** button marks it in the tracker. **Followed up** hides a follow-up for 7 days; it comes back sooner if the req moves to a new stage (callback or interview).
- **Picket Station:** one story from the latest briefing. Arrows step through the rest; buttons open the sources or the full briefing.

It is a real Tauri app (the same stack as CrowderSphere), not a browser tab. It has no title bar, sits on the desktop behind your other windows, stays out of the taskbar, and lives in the system tray.

## Using it

- **Reorder cards:** hover over a card and drag the dotted handle at its top edge, or use the arrows under Settings → Widget → Cards.
- **Move:** drag the top bar. **Resize:** drag any edge. Position and size are remembered.
- **Ctrl+Alt+Space** (anywhere) brings the widget up, even after Win+D, with the cursor in Quick note. In "On desktop" placement it sits on top until you click away, then goes back behind your windows.
- **Offline:** each card keeps its last good data. If a refresh fails (no network at startup, a service down), the card shows that data dimmed with "Couldn't refresh · showing data from …", and refreshes as soon as the network is back.
- **Updates:** Crowder Desk checks GitHub for a new version shortly after it starts and every 6 hours. When there is one, a banner offers **Install and restart**. Settings → About has **Check for updates**.
- **Tray icon:** left-click shows or hides the widget. Right-click gives Refresh, Settings and Quit.
- **The – button** (or Alt+F4) hides the widget to the tray. It keeps running.
- **Settings** (gear icon):
  - Location search and °F/°C
  - Blog Plan sign-in. It uses the same email and password as Blog Plan and Crowder Kitchen. Only a sign-in token is stored (in Windows Credential Manager), never the password.
  - Which recipe sections to pick from, and whether to favor favorites
  - News desk: All, Defense, Space or Tech
  - Placement: On desktop (behind windows), Normal, or Always on top
  - Background opacity, which cards to show, and whether to start with Windows
- **Refresh:** automatic. Weather every 15 minutes, tasks every 10, shoot scores and news every 30, and everything at midnight. F5 or the refresh button forces it.

Note: Win+D ("show desktop") hides any window, including this widget. Press Ctrl+Alt+Space or click the tray icon to bring it back.

**Secrets:** the Blog Plan sign-in token and the Job Tracker key are kept in Windows Credential Manager (as `com.crowder.desk` entries), not in the widget's settings. Versions before 1.3 kept them in the widget's local storage; 1.3 moves them on first start.

## Building

You need Node.js and Rust (`rustup`). You already have both from CrowderSphere.

```powershell
npm install
npm run dev      # run it in development
npm run build    # make the installers
```

The installers are written to `src-tauri\target\release\bundle\nsis\` (a setup `.exe`) and `...\bundle\msi\`.

### Or let GitHub build it

Under **Actions → Build Windows installer → Run workflow**, start a build and download the installer from the run's artifacts.

### Releasing a version

The in-app updater reads `latest.json` from the newest GitHub release, so the repo must be public and releases must be signed.

One-time setup: in the repo's **Settings → Secrets and variables → Actions**, add
- `TAURI_SIGNING_PRIVATE_KEY`: the contents of `%USERPROFILE%.tauricrowder-desk.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: leave empty (the key has no password)

Keep that key file safe. Without it, installed copies can't verify any future update. Its public half is in `tauri.conf.json` under `plugins.updater`.

Each release:

```powershell
npm run set-version 1.3.0   # updates package.json, tauri.conf.json, Cargo.toml, Cargo.lock
git commit -am "Crowder Desk 1.3.0"
git tag v1.3.0
git push origin main v1.3.0
```

The tag build checks that the version matches the tag, then publishes the release with the installers, their signatures and `latest.json`.

To build signed update files locally, set `$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw $env:USERPROFILE.tauricrowder-desk.key` before `npm run build`.

## iPhone (sideloaded test build)

The `ios` branch also builds an iPhone app from the same code. Every push to `ios` runs **Actions → Build iOS app**, which makes an unsigned `CrowderDesk.ipa` (in the run's artifacts, kept 30 days). No Mac or paid Apple account needed.

To install it from Windows:

1. Install **iTunes from apple.com** (not the Microsoft Store version) and **Sideloadly**.
2. Plug in the iPhone, drag `CrowderDesk.ipa` into Sideloadly, sign in with your Apple ID, and press Start.
3. On the iPhone: Settings → General → VPN & Device Management → your Apple ID → **Trust**. Developer Mode may also need turning on (Settings → Privacy & Security → Developer Mode).

A free Apple ID signature lasts **7 days**. Re-sign before then (Sideloadly again, or let AltStore refresh it over Wi-Fi). Install a new build over the old one rather than deleting the app, so settings and the sign-in stay.

What's different on iPhone: it's a normal full-screen app (no tray, placement, opacity, autostart, Ctrl+Alt+Space or auto-updates). Recipes open in the same screen with a back button. **Quick note** opens the Obsidian app to add the line, through Obsidian's `obsidian://daily` / `obsidian://new` links with `append`; Daily uses Obsidian's own Daily notes settings. In Settings, enter the vault's name as it appears in Obsidian on the phone. Secrets go in the iPhone Keychain.

### iPhone widget

The iPhone build includes a WidgetKit widget (`ios-widget/`). Add it like any widget: long-press the home screen or lock screen → Edit → Add Widget → Crowder Desk.

- **Lock screen:** one line above the clock (temperature and the next golden or blue hour), a circle (icon and temperature), or a rectangle (conditions, high and low, next light).
- **Home screen:** small (weather and next light), medium (adds the light windows, sunrise or sunset, and a 3-day forecast), large (adds the recipe of the day and a Picket Station headline, a different one each hour).

The widget fetches its own data (Open-Meteo and the public Supabase tables), refreshes about every 30 minutes, and keeps the last good data if a refresh fails. Its location is Mesa, set in `ios-widget/Sources/DeskData.swift`; it can't read the app's settings yet. Tauri has no setting for app extensions, so `scripts/ios-add-widget.py` adds the widget target to the generated Xcode project during the build.

## Where the data comes from

| Card | Source | Access |
|---|---|---|
| Weather | `api.open-meteo.com` | public |
| Blog Plan | Supabase `public.blogplan_tasks` | needs a Blog Plan member sign-in (RLS) |
| Recipe | Supabase `plico.recipes`, `plico.sections`, `plico.favorites` | public read; favorites need sign-in |
| News | Supabase `public.news_briefings` (latest `briefing_date`) | public |
| Light | `api.open-meteo.com` hourly cloud layers + sun/moon math in `src/sky.js` | public |
| Shoot Planner | Supabase `public.shoot_spots`, `public.shoot_outings`; `api.open-meteo.com`; `api.weather.gov` alerts | needs a Shoot Planner member sign-in (RLS) |
| Job search | Job Tracker Apps Script web app (`action=list` / `action=update`) | web app URL + KEY, set in Settings |
| Quick note | Files in your Obsidian vault, written by the Rust side (`append_note`) | local; writes only inside the vault |

The Supabase URL and publishable key are set in `src/api.js`. The publishable key is meant to ship in apps; row-level security still decides what it can read.

## Project layout

```
src/                 widget front end (plain HTML/CSS/JS, no bundler)
  index.html app.js  the widget
  recipe.html/js/css the recipe window
  api.js             settings, Supabase auth + REST, Open-Meteo
  shoot.js           Shoot Planner card data and scoring
  shootsky.js        copy of the Shoot Planner's sky.js (keep the two identical)
  icons.js           weather and UI icons
src-tauri/           Rust shell: window, tray, autostart, window-state, single-instance,
                     Ctrl+Alt+Space, Credential Manager secrets, updater
scripts/set-version.mjs  sets (or checks) the version in all four files
app-icon.png         1024px source icon (regenerate all sizes with `npm run icons`)
```

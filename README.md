# Crowder Desk

A small desktop widget for Windows. It shows seven cards at a glance:

- **Weather:** current conditions, today's high and low, wind, humidity, sunset time, and the next three days (Open-Meteo, no API key needed).
- **Blog Plan:** your next unchecked tasks with due dates. Tick a box and it's marked done in Blog Plan too.
- **Today's recipe:** one recipe from Crowder Kitchen each day, with your favorites picked more often. "View recipe" opens the whole recipe in its own window. The shuffle button picks another. A recipe shown in the last 14 days isn't picked again unless nothing else fits your section filter.
- **Light:** golden and blue hour for the next morning and evening, a color outlook for the next sunrise or sunset (from the high, mid and low cloud forecast), the moon's phase, rise and set, the next full or new moon, and the best night for stars in the coming week.
- **Quick note:** type a line and press Enter to add it to today's Obsidian daily note (using your Daily Notes folder and date format) or to an inbox note. Notes can be added as timestamped bullets, tasks or plain bullets.
- **Job search:** your open, starred, new and applied counts from the Job Tracker, starred reqs you haven't applied to (with a warning when the 1-month rule will drop them), and follow-ups that are due. Clicking a title opens the posting, and the **Applied** button marks it in the tracker. **Followed up** hides a follow-up for 7 days; it comes back sooner if the req moves to a new stage (callback or interview).
- **Picket Station:** one story from the latest briefing. Arrows step through the rest; buttons open the sources or the full briefing.

It is a real Tauri app (the same stack as CrowderSphere), not a browser tab. It has no title bar, sits on the desktop behind your other windows, stays out of the taskbar, and lives in the system tray.

## Using it

- **Reorder cards:** hover over a card and drag the dotted handle at its top edge, or use the arrows under Settings → Widget → Cards.
- **Move:** drag the top bar. **Resize:** drag any edge. Position and size are remembered.
- **Tray icon:** left-click shows or hides the widget. Right-click gives Refresh, Settings and Quit.
- **The – button** (or Alt+F4) hides the widget to the tray. It keeps running.
- **Settings** (gear icon):
  - Location search and °F/°C
  - Blog Plan sign-in. It uses the same email and password as Blog Plan and Crowder Kitchen. Only a sign-in token is stored, never the password.
  - Which recipe sections to pick from, and whether to favor favorites
  - News desk: All, Defense, Space or Tech
  - Placement: On desktop (behind windows), Normal, or Always on top
  - Background opacity, which cards to show, and whether to start with Windows
- **Refresh:** automatic. Weather every 15 minutes, tasks every 10, news every 30, and everything at midnight. F5 or the refresh button forces it.

Note: Win+D ("show desktop") hides any window, including this widget. Click the tray icon to bring it back.

## Building

You need Node.js and Rust (`rustup`). You already have both from CrowderSphere.

```powershell
npm install
npm run dev      # run it in development
npm run build    # make the installers
```

The installers are written to `src-tauri\target\release\bundle\nsis\` (a setup `.exe`) and `...\bundle\msi\`.

### Or let GitHub build it

Push this folder to a GitHub repo. Then, under **Actions → Build Windows installer → Run workflow**, start a build and download the installer from the run's artifacts. Pushing a tag like `v1.0.0` also attaches the installers to a GitHub release.

## Where the data comes from

| Card | Source | Access |
|---|---|---|
| Weather | `api.open-meteo.com` | public |
| Blog Plan | Supabase `public.blogplan_tasks` | needs a Blog Plan member sign-in (RLS) |
| Recipe | Supabase `plico.recipes`, `plico.sections`, `plico.favorites` | public read; favorites need sign-in |
| News | Supabase `public.news_briefings` (latest `briefing_date`) | public |
| Light | `api.open-meteo.com` hourly cloud layers + sun/moon math in `src/sky.js` | public |
| Job search | Job Tracker Apps Script web app (`action=list` / `action=update`) | web app URL + KEY, set in Settings |
| Quick note | Files in your Obsidian vault, written by the Rust side (`append_note`) | local; writes only inside the vault |

The Supabase URL and publishable key are set in `src/api.js`. The publishable key is meant to ship in apps; row-level security still decides what it can read.

## Project layout

```
src/                 widget front end (plain HTML/CSS/JS, no bundler)
  index.html app.js  the widget
  recipe.html/js/css the recipe window
  api.js             settings, Supabase auth + REST, Open-Meteo
  icons.js           weather and UI icons
src-tauri/           Rust shell: window, tray, autostart, window-state, single-instance
app-icon.png         1024px source icon (regenerate all sizes with `npm run icons`)
```

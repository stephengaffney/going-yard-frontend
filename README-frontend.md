# Going Yard & Drinking Hard — Frontend

The Progressive Web App (PWA) frontend for [Going Yard & Drinking Hard](https://going-yard-frontend.vercel.app/), an MLB home run drinking game tracker built for a group of friends during the 2026 season.

**Live app:** [https://going-yard-frontend.vercel.app/](https://going-yard-frontend.vercel.app/)  
**Backend repo:** [stephengaffney/hr-game](https://github.com/stephengaffney/hr-game)

---

## What This Is

Going Yard & Drinking Hard is a real-time drinking game tied to live MLB home run data. When a tracked player hits a home run, the app instantly notifies all players, creates a feed card with drink instructions, starts a 24-hour countdown timer, and tracks completion. The frontend is a mobile-first PWA installable on iOS and Android — it behaves like a native app with push notifications, offline caching, and deep linking from notifications.

For full game mechanics, see [GAME_MECHANICS.md](./GAME_MECHANICS.md).

---

## Architecture

The frontend is a single `index.html` file. There is no build step, no bundler, and no framework CLI — React and ReactDOM are loaded from CDN, and all application code is written directly in a `<script>` tag alongside the CSS.

```
index.html      ← entire application: HTML, CSS, and React (via CDN)
manifest.json   ← PWA manifest
sw.js           ← service worker (caching + push handling)
icon.svg        ← app icon
```

The app communicates with two backends:

- **Supabase** — directly from the browser via the JS client and anon key, for all data reads, real-time subscriptions, and video file uploads
- **Flask API on Railway** — for write operations requiring the service role key or shared secrets (drink assignments, approvals, push registration, video upload notifications)

---

## Services Used

### Vercel
Vercel hosts the frontend as a static site. There is no build step — Vercel serves the files exactly as they exist in the repository. Every push to the main branch triggers an automatic redeploy.

Key things Vercel must serve from the root path for the PWA to function correctly:
- `index.html` — the application
- `manifest.json` — required for "Add to Home Screen" on iOS and Android
- `sw.js` — must be served from the root so the service worker has scope over the entire origin
- `icon.svg` — referenced by the manifest

No environment variables are configured in Vercel — the Supabase anon key and backend URL are hardcoded constants in `index.html` (the anon key is safe to expose publicly; it is limited by Supabase's Row Level Security).

### Supabase
Supabase provides four services the frontend uses directly:

| Supabase service | How the frontend uses it |
|---|---|
| **Postgres** | All data reads — `hr_events`, `drink_log`, `comments`, `likes`, `chug_videos`, leaderboard views, `app_settings` |
| **Auth** | Sign-up and sign-in (email + password). The JWT from Supabase Auth is passed as a Bearer token to the Flask API for authenticated routes. |
| **Realtime** | Each `HRCard` subscribes to its own channel, listening for Postgres row changes on `drink_log`, `drink_assignments`, `comments`, and `likes`. The feed listens for new `hr_events` inserts to show the unread dot. |
| **Storage** | Chug videos are uploaded directly from the browser to the `chug-videos` bucket — the Flask backend is bypassed entirely for the upload itself. The public URL returned by Storage is saved to the `chug_videos` table and linked directly to other users. |

### MLB Stats API
Player headshot images displayed on feed cards are fetched directly from MLB's photo CDN:

```
https://img.mlbstatic.com/mlb-photos/image/upload/w_120,q_auto:best/v1/people/{mlb_id}/headshot/silo/current.png
```

Team logos are fetched from:

```
https://www.mlbstatic.com/team-logos/{team_id}.svg
```

These are public URLs with no authentication. If a headshot fails to load (e.g. a player with no official photo), the `PlayerHeadshot` component falls back to a colored circle showing the player's initials.

---

## Repository Structure

```
going-yard-frontend/
├── index.html      # The entire application
├── manifest.json   # PWA manifest (name, icons, theme color, display mode)
├── sw.js           # Service worker (caching + push handling + deep links)
└── icon.svg        # App icon (SVG, any size, maskable)
```

---

## Frontend Stack

| Concern | Approach |
|---|---|
| Framework | React 18 (CDN UMD build, no bundler) |
| Styling | Inline `<style>` block with CSS custom properties |
| Database client | `@supabase/supabase-js` v2 (CDN) |
| Real-time | Supabase Realtime (Postgres changes over WebSocket) |
| Video recording | `MediaRecorder` API (in-browser, no native app required) |
| Push notifications | Web Push API + service worker + VAPID |
| Hosting | Vercel (static, no build step, auto-deploy from GitHub) |
| Fonts | Google Fonts — Bebas Neue (display) + DM Sans (body) |

---

## Application Structure

### Screens / Tabs

| Tab | Component | Description |
|---|---|---|
| Feed | `FeedScreen` | Reverse-chronological list of HR event cards with drink status, timers, comments, likes, and action buttons |
| Leaders | `LeaderboardScreen` | Five sub-views: Drink Leaderboard, 20 HR Slugger race, Big Hitter, MLB HR totals, Combined |
| Log | `LogScreen` | Filterable table of every drink log entry, tappable to navigate to the matching feed card |
| Chugs | `VideosScreen` | Grid of uploaded chug videos with likes and comments (admin-toggled feature flag) |

### Key Components

| Component | Purpose |
|---|---|
| `HRCard` | The central feed card. Displays player info, drink assignment, status badge, live countdown timer, action buttons, and threaded comments. Manages all local state for its own likes, comments, assignment, approval, and video upload. |
| `AssignModal` | Bottom sheet for assigning a "you drink" to another player. Swipe-to-dismiss enabled. |
| `UploadModal` | Bottom sheet for recording or uploading a chug video. Supports in-browser recording via `MediaRecorder` and camera roll upload. Max 25 seconds. Warns user before recording that video is permanent and visible to the whole group. |
| `VideoCard` | Displays a single chug video with uploader metadata, likes, and threaded comments. Links back to the originating feed card. |
| `NotificationCenter` | Bell icon in the header. Renders a portal-based dropdown with the last 20 notifications, per-type filter toggles, and mark-all-read. |
| `LeaderboardScreen` | Tabbed leaderboard with a podium layout for the top 3 drink leaders and a flat ranked list below. |
| `SearchFilterBar` | Sticky search input plus chip filters on Feed and Log tabs. Includes a custom `DateRangePicker` calendar sheet. |
| `DateRangePicker` | Full calendar bottom sheet for filtering events by date range. Shows dots on days that have HR events. |
| `AuthScreen` | Sign in / register screen. Registration requires a group password to gate access to the app. |
| `SettingsScreen` | Profile display, sign out, and per-type push notification preferences saved to the backend. |
| `PlayerHeadshot` | Fetches and displays an MLB player's official headshot. Falls back to an initials avatar if the image fails to load. |
| `Avatar` | Colored circle avatar for game participants, using each user's personal color. |

---

## End-to-End Event Flow

This is the complete journey from a home run being hit to every user seeing it:

1. **MLB Stats API** finalizes game data — player's cumulative season HR total increases
2. **`hr_poller4.py`** (Mac desktop) detects the increase and POSTs to `/webhook/hr` on Railway
3. **Flask backend** inserts rows into `hr_events` and `drink_log` in Supabase, then sends VAPID push to all subscribed devices
4. **Supabase Realtime** pushes the new `hr_events` insert to all open browser sessions — the Feed tab unread dot appears instantly without a page refresh
5. **Push notification** arrives on each device — the service worker shows a system notification with player name and drink instruction
6. **User taps the notification** — service worker reads `hr_event_id` from the payload, opens the app to `/?event={id}`
7. **App loads**, parses the deep link, navigates to the Feed tab, scrolls to the matching `HRCard`, flashes a gold highlight animation
8. **`HRCard`** loads its `drink_log`, `comments`, and `likes` from Supabase and renders the live countdown timer

---

## Data Flow

### Reading data

All reads go directly to Supabase from the browser using the anon key:

```javascript
const { data } = await sb.from('hr_events')
  .select('*')
  .order('created_at', { ascending: false })
  .limit(50);
```

### Real-time subscriptions

Each `HRCard` subscribes to its own Supabase Realtime channel on mount:

```javascript
const chan = sb.channel(`hr-${event.id}`)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'drink_log' }, loadData)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'drink_assignments' }, loadData)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'likes' }, loadData)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, loadData)
  .subscribe();
```

Because Supabase replication can lag slightly after a drink assignment, the `drink_assignments` handler retries `loadData` with exponential backoff (1.5s, 2.5s, 4s, 6s) to ensure `given_to` is populated before re-rendering.

### Writing to the Flask backend

Writes requiring secrets or service-role access go through the Flask API with the user's Supabase JWT:

```javascript
const { data: { session } } = await sb.auth.getSession();
await fetch(`${BACKEND}/assign`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session.access_token}`
  },
  body: JSON.stringify({ hr_event_id, assignee, message })
});
```

### Video upload flow

Video uploads bypass the Flask backend entirely:

1. User records or selects a video in `UploadModal`
2. Frontend calls `/videos/cleanup` on the backend to delete the oldest video if the library is at capacity
3. Frontend uploads the file directly to Supabase Storage (`chug-videos` bucket) using the JS client
4. Frontend inserts a row into the `chug_videos` table with the public URL and metadata
5. Frontend calls `/videos/notify` on the backend to dispatch personalised push notifications to all other users

---

## Drink Status & Countdown

Drink status is computed client-side on every render by `computeStatus()`. This mirrors the backend's 24-hour clock logic so the UI is always accurate even before the backend late sweep runs.

### Status display mapping

| Computed status | Display label | Card border |
|---|---|---|
| `pending` (you_drink) | ⏳ To Be Assigned | Gold pulse animation |
| `pending` (i_drink) | ⏳ To Be Drank | Gold pulse animation |
| `awaiting_approval` | 🍺 To Be Drank | Gold pulse animation |
| `late` | 🔴 Late! | Red pulse animation |
| `vacated` | 🔴 Vacated | Red pulse animation |
| `completed` | ✅ Completed | No border |
| `completed_late` | ⚠️ Completed Late | Static orange border |

> `vacated` is frontend-only. It is shown for any `late` row where `drink_type = 'you_drink'` and `given_to` is null — a "you drink" that expired without ever being assigned. The database stores this as `late`.

### Live countdown

`useCountdown()` updates every second and drives the countdown badge:

- **Green** (`ok`) — more than 6 hours remaining
- **Gold** (`warning`) — less than 6 hours remaining
- **Red pulsing** (`urgent`) — less than 2 hours remaining

---

## Push Notifications

### Registration flow

`registerPush()` runs on every sign-in and every app load:

1. Registers `sw.js` as a service worker and waits for it to become active
2. Requests notification permission from the browser
3. Fetches the VAPID public key from `/push/vapid-public-key` on the Flask backend
4. Checks for an existing `PushManager` subscription
5. If the stored subscription's VAPID key doesn't match the current one (iOS rotates endpoints silently), unsubscribes and re-subscribes
6. POSTs the subscription object to `/push/subscribe` on the backend

### Notification types

| Type | When it fires |
|---|---|
| `hr` | A tracked player hits a home run |
| `assignment` | A "you drink" is assigned to someone |
| `approval` | A drink is confirmed as consumed |
| `late` | A drink has exceeded the 24-hour window |
| `comment` | Someone comments on a feed card or video you're involved in |
| `like` | Someone likes your feed card or video |
| `video` | A chug video is uploaded |

Each user can toggle any type on or off in Settings → Push Notifications. Preferences are saved to `notification_preferences` via the backend and applied server-side before every push is dispatched.

### Deep linking from notifications

The service worker builds a URL from the notification's data payload:

- `video_id` present → `/?tab=videos&video={videoId}` — opens Chugs tab, scrolls to that video
- `hr_event_id` present → `/?event={eventId}` — opens Feed tab, scrolls to that card with a gold flash animation

---

## PWA Details

The app is installable on iOS ("Add to Home Screen") and Android.

**`manifest.json`**
- Name: "Going Yard & Drinking Hard" / short name: "Going Yard"
- Display mode: `standalone` (no browser chrome when installed)
- Theme and background color: `#0a0a0f`
- Icon: `icon.svg` (any size, maskable)

**`sw.js`**
- Cache name: `gyard-v1`
- Caches `/` and `/index.html` on install
- Network-first fetch strategy — serves from cache only on network failure
- Old caches (different version strings) are deleted on activate
- Handles `push` events and shows system notifications
- Handles `notificationclick`, builds the deep link URL, and focuses or opens the app

To bust the cache after a deploy, increment the `CACHE` version string at the top of `sw.js`.

---

## Authentication

Auth is handled by Supabase Auth (email + password). Registration requires a group password shared out-of-band — this prevents outsiders from creating accounts.

Usernames are fixed to the seven participants. The username selected at registration determines:
- Which matchup is shown on feed cards
- The user's personal color accent throughout the app
- Which MLB team colors are applied to the header accent strip on sign-in

---

## Theming

The app uses CSS custom properties for all colors:

```css
:root {
  --bg: #0a0a0f;
  --surface: #13131a;
  --surface2: #1c1c26;
  --border: rgba(255,255,255,0.08);
  --text: #f0f0f0;
  --muted: #888;
  --accent: #e8c14a;  /* overridden per team on login */
}
```

On sign-in, `setTeamIcon()` overrides `--accent`, `--team-primary`, and `--team-secondary` based on the user's MLB team:

| Team | Primary | Accent |
|---|---|---|
| NYY (Yankees) | `#003087` navy | `#C4CED4` silver |
| PHI (Phillies) | `#E81828` red | `#E81828` red |
| HOU (Astros) | `#EB6E1F` orange | `#EB6E1F` orange |

Individual participant colors (`USER_COLORS`) and MLB player colors (`PLAYER_COLORS`) are constants used throughout for avatars, leaderboard progress bars, and card accents.

---

## Feature Flags

The Chugs tab is gated behind a `videos_enabled` key in Supabase's `app_settings` table. The flag is read on app load. Only the user `steve` can toggle it from the header. When disabled, the tab disappears from the nav and users on it are redirected to Feed.

---

## Leaderboard Tabs

| Tab | Data source | What it shows |
|---|---|---|
| Drink Leaderboard | `drink_log` (client-side aggregation) | Total drinks per player. Podium for top 3. Late and vacated counts as badges. |
| 20 HR Slugger | `hr_totals` Supabase view | Progress bar race to 20 HRs for each player's "I Drink" MLB player. |
| Big Hitter | `hr_totals` Supabase view | Bar chart of each player's "You Drink" MLB player's HR total. |
| MLB Home Runs | `hr_totals` Supabase view | All 14 tracked players ranked by season HR total. |
| Combined | `leaderboard` Supabase view | Aggregate drinks per player. Counts obligation owner (`username`), not physical drinker (`given_to`). |

---

## Player & Matchup Reference

| Participant | I Drink Player | You Drink Player |
|---|---|---|
| Frank | Yanier Diaz | Yordan Alvarez |
| Scott | Adolis Garcia | Bryce Harper |
| Tyler | Anthony Volpe | Ben Rice |
| Ned | Jasson Dominguez | Jazz Chisholm Jr. |
| Ryan | Trea Turner | Kyle Schwarber |
| Steve | Austin Wells | Trent Grisham |
| Dan | Ryan McMahon | Aaron Judge |

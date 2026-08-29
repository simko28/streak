# Habits

A habit tracker, task list and progress journal. The whole app is one HTML file,
with a manifest, a service worker and four icons alongside it so phones can
install it. No build step, no dependencies, no framework, no network calls.

| file                     | what it is                                    |
|--------------------------|-----------------------------------------------|
| `index.html`             | the entire app                                |
| `manifest.webmanifest`   | name, colours, icons for the installed app    |
| `sw.js`                  | offline cache of the shell                    |
| `icon-*.png`, `apple-touch-icon.png` | home screen icons             |
| `sync/`                  | optional Cloudflare Worker, off unless deployed |

## Run it

```bash
# any static server, pick one
npx serve .
python3 -m http.server 8000
```

Then open the address it prints. Serve it, do not open `index.html` with
`file://`: IndexedDB is happier over http, and a service worker will not
register on `file://` at all. `localhost` counts as secure, so the install
machinery works there too.

## Put it on your phone

Free, no account beyond GitHub, no build step.

1. github.com, **New repository**, name it `streak`, **Public**. Pages is free
   on public repos.
2. **uploading an existing file**, drag in all seven files, Commit.
3. **Settings, Pages**, source **Deploy from a branch**, `main` and `/ (root)`,
   Save. A minute later it is live at `https://<you>.github.io/streak/`.
4. On the phone open that link **in Safari** (iOS) or Chrome (Android), then
   Share, **Add to Home Screen**. Android also offers Install.

Every path in the app is relative, so a project subdirectory like `/streak/`
works with nothing to configure. Cloudflare Pages and Netlify are the same
drag-and-drop story if you prefer them.

**Install before you import.** On iOS the installed app gets its own storage,
separate from Safari's. Anything you type into the Safari tab does not follow
you to the Home Screen icon. So: install, open from the icon, then paste your
backup into Import.

Once installed it opens full screen with no browser chrome, keeps working with
no signal, and stops being subject to Safari's habit of clearing data for sites
you have not visited in seven days.

## Sync across devices

Off by default, and off is a real off: with no sync configured the app makes no
network requests at all. No account, no email, no third party. Turn it on and
your phone and computer share one history.

A **sync code** is a long random string the app invents on the first device.
Paste it into the second device and both read and write the same row. The
server hashes the code before using it as a key, so a dump of the database does
not hand anyone your codes. Whoever holds the code holds the habits, so treat it
like a password.

Photos do not travel. They are megabytes and they live in IndexedDB; habits,
log, tasks and the settings (theme, greeting, name) are what sync. Move photos
with a full backup.

### Deploying the worker

Needs a free Cloudflare account. Nothing here costs anything at one user: the
free tier is 100k requests a day and 5 GB, and this app makes a few dozen
requests a day and stores a few hundred KB.

```bash
cd sync
npx wrangler login
npx wrangler d1 create streak          # paste the id it prints into wrangler.toml
npx wrangler d1 execute streak --remote --file=schema.sql
npx wrangler deploy                    # prints your https://streak-sync.<you>.workers.dev
```

Then in the app: menu, **Sync across devices**, paste that address, **Start
syncing this device**. On the second device paste the same address plus the code
from the first, and press Join.

Optionally set `SYNC_URL` at the top of the sync block in `index.html` so the
address is prefilled on every device.

### How a merge is decided

Every device keeps the last state it agreed on with the server. That gives a
real three way merge instead of last-write-wins:

- one side still matches the base, so it did not touch that record: the other side wins
- both sides changed the same record: this device wins, and the toast says how many
- deleted on one side, untouched on the other: the deletion travels
- deleted on one side, edited on the other: the edit rescues it

Ticks land per habit per day, so two devices used on the same day merge cleanly
rather than one overwriting the other. Pushes only happen when the merge differs
from the server, otherwise two devices bounce version bumps off each other
forever.

### Adding Google sign-in later

The storage protocol does not change. It becomes one more route on the worker
that verifies a Google ID token and hands back the sync code already stored for
that account, creating one on first sign-in. Signing in then just means "fetch
my code", and anonymous codes keep working exactly as they do now.

## Updating it after it is live

Upload the changed file, wait a minute, reopen the app. The service worker
serves the cached copy first and fetches the new one behind it, so the change
shows up on the launch after that. To make it land on the very next open,
bump `V` in `sw.js` when you deploy.

## Moving your data across from the Claude artifact

1. In the artifact: menu, Export, **Download full backup with photos**
2. Here: menu, Import, paste the file contents, Replace my data

The plain export skips photos. The full backup includes them as data URLs, so
it is large but complete.

## How storage works

The file ships with an adapter at the top of `index.html`:

- Inside a Claude artifact, `window.storage` already exists and is used as is
- Anywhere else, the shim provides the same API using `localStorage` for state
  and IndexedDB for photos, since base64 images exceed the localStorage quota fast

Nothing in the app knows which one is active. That is deliberate: keep the
adapter as the only place that touches persistence, and a server backend later
means rewriting that block alone.

The app also asks for `navigator.storage.persist()` on boot. Browsers grant it
freely to installed apps, which is the difference between history that survives
and history a quiet week of not opening the app can erase.

Keys in use:

| key                    | contents                                  |
|------------------------|-------------------------------------------|
| `loop-habits-v1`       | habits, log, tasks, photo index, settings  |
| `photo:<habitId>:<date>` | one full image, JPEG 900px q0.70        |
| `thumbs:<habitId>`     | all thumbnails for a habit, 190px q0.60    |

Thumbnails are batched so opening a gallery is one read, not thirty.

## Data model

```js
habit = {
  id, name, question, icon, color, pos, pinned, archived,
  type: 'yes' | 'num' | 'list',
  target,        // num: daily goal, list: things per day
  unit,          // num only
  fnum, fden,    // frequency, e.g. 3/7
  days: [2],     // weekday schedule, empty means every day
  remind: '08:00',
  photo: false,  // camera on this habit
  since, created
}

task = { id, text, due, doneAt }         // one-off, excluded from all habit metrics
log[habitId][date] = 1 | -1 | number | [strings]   // done | skipped | measurement | list

settings = { theme, greet, name }        // greet: the clock-based line on Today
```

Scoring is an exponential moving average with a 13 day half life. Days a habit
is not scheduled for are skipped entirely rather than counted as misses.

## What to build next, in order of payoff

1. **Push notifications.** The one thing this still cannot do. The manifest and
   service worker are in place now, so what is left is VAPID keys, a
   `pushsubscription` stored somewhere, and a cron job that pushes at each
   reminder time. Cloudflare Workers free tier covers it. On iOS this only works
   from the installed Home Screen app, never from a Safari tab. Until then the
   app only nags on days you remember to open it, or through the calendar
   events under Settings, Reminders.
2. **Sync for photos.** The state syncs; the images do not. They want R2 or
   similar, keyed the same way, uploaded once and never rewritten.
3. **Streak insurance.** Two automatic passes a month so one miss does not zero
   the counter and end the run.
4. **Weekly review.** Surface habits under 50 percent and offer to lower the
   target.

## Starter prompt for Claude Code

> This is a habit tracker: the whole app is index.html, vanilla JS, no build
> step, already installable as a PWA via manifest.webmanifest and sw.js. Storage
> goes through the adapter at the top of index.html and nothing else touches
> persistence. Add web push for the reminder times: a Cloudflare Worker holding
> the subscriptions and a cron trigger that pushes at each habit's remind time.
> Do not change the app logic or the storage keys.

## Conventions worth keeping

- One file for the app, no build. The three files beside it exist only so a
  phone can install it, and none of them contain app logic.
- All persistence behind the adapter.
- Habit metrics never count tasks, and never count days a habit was not due.
- The `since` date changes what the user reads, never what is scored.

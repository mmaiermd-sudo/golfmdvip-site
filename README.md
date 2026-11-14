# Golden Helmets & Green Jackets

Static site for [golfmdvip.net](https://golfmdvip.net), published with GitHub Pages from `main`.

GitHub Pages builds this site with Jekyll. A folder whose name starts with an underscore stays in the repo and is not copied to the live site. Do not add a `.nojekyll` file; that would publish those folders.

## Adding new videos

`scripts/add_new_videos.py` reads the public YouTube RSS feed for [@GoldenHelmetsandGreenJackets](https://www.youtube.com/@GoldenHelmetsandGreenJackets) and inserts any upload whose video id is not already in the site HTML.

```bash
python3 scripts/add_new_videos.py
```

What it inserts:

- A title that starts with `Episode N` becomes a full episode at the top of `episodes.html`. When that episode number is newer than the one on the home page, it also becomes the featured video in the home page latest section. The previous episode stays on the episodes page.
- Shorts go into `shorts.html`, inside the matching episode section when the title or description names one (for example `Episode 14`). Otherwise they go in a Latest section. New Shorts are also added to the home page Quick hits.
- Other uploads, such as picks shows and bonus videos, are added as cards in the bonus section of `episodes.html`. A picks or locks show is placed with the existing locks cards.

The script only inserts those cards. It does not remove existing cards or rewrite other pages (Beat the GolfDoc, athlete pages, NDOS, and the weekly picks page stay as they are). Thumbnails use an `i.ytimg.com` image that returns HTTP 200, falling back to `hqdefault`.

Run it a second time to confirm it adds nothing. YouTube's public RSS feed lists the latest 15 uploads, so a daily run picks up new videos while they are still in that window.

## Beat the GolfDoc team rosters

`scripts/build_btg_team_rosters.py` rebuilds `btg-team-rosters.json` and the "All teams" table on `beat-the-golfdoc.html` (between the `BTG-ALL-TEAMS` markers), so every team shows, including new teams with no graded picks yet. Clicking a team opens its members by call sign.

Inputs are private Google Drive exports of the standings sheet and the weekly responses sheet (never commit them). The public output holds call signs and points only, and the script refuses to write if an email address would end up in it.

```bash
python3 scripts/build_btg_team_rosters.py --standings /tmp/h1.md \
  --week "/tmp/w11.md:Form Responses 3" \
  --form-url "https://docs.google.com/forms/d/e/<form id>/viewform" --extra-team Concentra
```

Graded stats are carried over from the existing JSON, so a rerun with the same inputs changes nothing but the timestamp.

## Beat the GolfDoc live leaderboard

The weekly board on `beat-the-golfdoc.html#live` is filled in the browser. It reads `data/btg-live-week.json`, then the picks file that pointer names, then the ESPN scoreboard URL inside that picks file. Official points count only after a game is final. The page refreshes about every 90 seconds. Call signs only: do not put names or email addresses in these files.

To roll to a new week, replace the picks file and point the pointer at it. Nothing else on the page has to change.

1. Add `data/btg-week12-picks.json` using the same shape as `data/btg-week11-picks.json` (games with GolfDoc's side and spread, parlays and their legs, scoring, `scores_feed`, and entries of call sign + picks + parlay agree/disagree).
2. Edit `data/btg-live-week.json` so `picks` is `data/btg-week12-picks.json` and `week` / `label` match.
3. Optional: replace `data/btg-live.json` if you want a same-site snapshot for when the ESPN scoreboard cannot be read from the browser. The page then says scores update periodically. Leave the pointer's `snapshot` path as-is, or change it to the new file.

`node btg-live.test.js` checks the grader. A push scores 0. A parlay hits only when every GolfDoc leg covers, and it misses once any leg fails.

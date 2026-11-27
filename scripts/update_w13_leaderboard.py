#!/usr/bin/env python3
"""Refresh the Beat the GolfDoc Week 13 live leaderboard on golfmdvip.net.

Fetches ESPN public scoreboards for Friday Nov 27 and Saturday Nov 28, 2026,
grades locked entries with the site's btg-live.js grader, writes
data/btg-live-week13.json, and can commit + push to the website repo.

Usage (from this folder or any cwd):

  python3 update_w13_leaderboard.py
  python3 update_w13_leaderboard.py --site /path/to/golfmdvip-site
  python3 update_w13_leaderboard.py --commit --push
  python3 update_w13_leaderboard.py --verify

Scheduled refresh windows (America/Chicago):
  Friday Nov 27, 2026:  3:00 PM, 6:30 PM, 11:30 PM CT
  Saturday Nov 28, 2026: 3:00 PM, 6:30 PM, 11:30 PM CT

Saturday kickoffs (CT):
  11:00 AM  Michigan at Ohio State (FOX)
  11:00 AM  Notre Dame at Syracuse (ABC) — Bonus Game
  2:00 PM   South Carolina at Clemson (ESPN2)
  2:30 PM   USC at UCLA (CBS)
  6:00 PM   Purdue at Indiana (FS1)
  6:30 PM   Washington at Oregon (NBC)
  6:30 PM   Auburn at Alabama (ABC)
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

CT = ZoneInfo("America/Chicago")
HERE = Path(__file__).resolve().parent
DEFAULT_SITE_CANDIDATES = [
    Path("/workspace/golfmdvip-site-w13"),
    Path("/workspace/golfmdvip-site-ro"),
    Path.cwd(),
]
ESPN_URLS = [
    "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=20261127&groups=80&limit=400",
    "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=20261128&groups=80&limit=400",
]
LIVE_URL = "https://golfmdvip.net/beat-the-golfdoc.html"
POINTER_REL = Path("data/btg-live-week.json")
PICKS_REL = Path("data/btg-week13-picks.json")
SNAP_REL = Path("data/btg-live-week13.json")
CACHE_DIR = HERE


def find_site(explicit: Path | None) -> Path:
    if explicit:
        site = explicit.resolve()
        if not (site / PICKS_REL).exists() and not (site / "btg-live.js").exists():
            raise SystemExit(f"Site root does not look like golfmdvip-site: {site}")
        return site
    env = os.environ.get("GOLFMDVIP_SITE")
    if env:
        return Path(env).resolve()
    for cand in DEFAULT_SITE_CANDIDATES:
        if (cand / "btg-live.js").exists():
            return cand.resolve()
    raise SystemExit("Could not find the golfmdvip-site checkout. Pass --site.")


def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "golfmdvip-w13-live/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def merge_espn(payloads: list[dict]) -> dict:
    events = []
    seen = set()
    for payload in payloads:
        for event in (payload or {}).get("events") or []:
            eid = str(event.get("id") or "")
            if eid and eid in seen:
                continue
            if eid:
                seen.add(eid)
            events.append(event)
    return {"events": events}


def grade_with_node(site: Path, week: dict, espn: dict, cache_dir: Path) -> dict:
    espn_path = cache_dir / "espn_merged.json"
    out_js = cache_dir / "_grade_w13.js"
    espn_path.write_text(json.dumps(espn), encoding="utf-8")
    # Keep a dated copy too
    now = datetime.now(CT)
    dated = cache_dir / f"espn_merged_{now.strftime('%Y%m%d_%H%M')}_CT.json"
    dated.write_text(json.dumps(espn), encoding="utf-8")
    week_path = cache_dir / "_week13_picks.json"
    week_path.write_text(json.dumps(week), encoding="utf-8")
    out_js.write_text(
        f"""
const fs = require('fs');
const api = require({json.dumps(str(site / 'btg-live.js'))});
const week = JSON.parse(fs.readFileSync({json.dumps(str(week_path))}, 'utf8'));
const espn = JSON.parse(fs.readFileSync({json.dumps(str(espn_path))}, 'utf8'));
const parsed = api.parseEspn(week, espn);
const board = api.grade(week, parsed);
const now = new Date();
const asof = api.formatAsOfCT(now);
const snap = {{
  schema: 'btg-live/1',
  week: 13,
  title: 'Beat the GolfDoc Week 13 — Live Standings as of ' + asof,
  as_of: asof,
  generated_at: now.toISOString(),
  scoring: week.scoring && week.scoring.rule ? week.scoring.rule : '',
  source_scores: 'ESPN public scoreboard (site.api.espn.com)',
  games_final: board.gamesFinal,
  games_total: board.games.length,
  entries: board.total,
  golfdoc_points: board.golfdocPoints,
  golfdoc_live: board.golfdocLive,
  beating_golfdoc: board.beating,
  max_points: board.maxPoints,
  games: board.games.map(g => ({{
    game: g.matchup,
    short: g.short,
    golfdoc_pick: g.golfdocPick,
    kickoff: g.kickoff,
    state: g.phase === 'final' ? 'FINAL' : (g.phase === 'live' ? 'LIVE' : 'NOT STARTED'),
    detail: g.whenLabel,
    score: g.scoreLabel === '—' ? '' : g.scoreLabel,
    golfdoc_side: g.cover
  }})),
  parlays: Object.fromEntries(board.parlays.map(p => [p.name, {{
    status: String(p.status).toUpperCase(),
    if_current_scores_hold: String(p.liveStatus).toUpperCase()
  }}])),
  individual: board.rows.map(r => ({{
    rank: r.rank,
    call_sign: r.callSign,
    points: r.points,
    live_points_if_current_scores_hold: r.live,
    max_possible: r.max,
    vs_golfdoc: r.vs
  }}))
}};
const missing = (week.games || []).filter(g => parsed[g.id] && parsed[g.id].missing).map(g => g.short);
process.stdout.write(JSON.stringify({{ snap, boardSummary: {{
  asof, final: board.gamesFinal, started: board.gamesStarted, golfdoc: board.golfdocPoints,
  golfdocLive: board.golfdocLive, beating: board.beating, total: board.total, maxPoints: board.maxPoints,
  missing
}}, games: board.games.map(g => ({{ short: g.short, phase: g.phase, score: g.scoreLabel, when: g.whenLabel, cover: g.coverLabel }})),
  parlays: board.parlays,
  top: board.rows.slice(0, 15).map(r => ({{ rank: r.rank, callSign: r.callSign, points: r.points, live: r.live, max: r.max, vs: r.vsLabel }}))
}}, null, 1));
""",
        encoding="utf-8",
    )
    proc = subprocess.run(["node", str(out_js)], check=True, capture_output=True, text=True)
    return json.loads(proc.stdout)


def write_pointer(site: Path) -> None:
    pointer = {
        "schema": "btg-live-week/1",
        "week": 13,
        "label": "Week 13",
        "picks": "data/btg-week13-picks.json",
        "snapshot": "data/btg-live-week13.json",
    }
    (site / POINTER_REL).write_text(json.dumps(pointer, indent=2) + "\n", encoding="utf-8")


def git(site: Path, args: list[str], check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(site), *args], check=check, text=True, capture_output=True)


def maybe_commit_push(site: Path, asof: str, started: int, final: int, do_commit: bool, do_push: bool) -> None:
    files = [str(POINTER_REL), str(PICKS_REL), str(SNAP_REL)]
    # Also add JS/HTML/images if dirty — but the updater's routine runs should
    # only refresh the snapshot once the initial roll is in place.
    status = git(site, ["status", "--porcelain", "--", *files]).stdout.strip()
    if not status:
        print("No git changes in Week 13 live data files.")
        return
    if not do_commit:
        print("Data files changed (not committed). Pass --commit to record them.")
        print(status)
        return
    git(site, ["add", "--", *files])
    msg = f"Update Beat the GolfDoc Week 13 live standings as of {asof} ({final} final, {started} started)"
    git(site, ["commit", "-m", msg])
    print("Committed:", msg)
    if do_push:
        git(site, ["push", "origin", "HEAD"])
        print("Pushed to origin.")


def verify_live() -> None:
    import urllib.error

    urls = [
        "https://golfmdvip.net/beat-the-golfdoc.html",
        "https://golfmdvip.net/picks.html",
        "https://golfmdvip.net/data/btg-live-week.json",
        "https://golfmdvip.net/data/btg-week13-picks.json",
        "https://golfmdvip.net/data/btg-live-week13.json",
        "https://golfmdvip.net/img/btg/W13_GolfDoc_ATS_Record_Helmet_1080x1350.png",
        "https://golfmdvip.net/img/btg/W13_GolfDoc_ATS_Record_Helmet_1920x1080.png",
    ]
    for url in urls:
        req = urllib.request.Request(url, headers={"User-Agent": "golfmdvip-w13-live/1.0", "Cache-Control": "no-cache"})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = resp.read()
                print(f"HTTP {resp.status} {url} ({len(body)} bytes)")
                if url.endswith(".json"):
                    data = json.loads(body.decode("utf-8"))
                    if "week" in data:
                        print(f"  week={data.get('week')} title={data.get('title') or data.get('label')}")
                elif url.endswith(".html"):
                    text = body.decode("utf-8", "replace")
                    for needle in [
                        "Week 13 individual standings",
                        "W13_GolfDoc_ATS_Record_Helmet",
                        "35-25-0",
                        "data/btg-live-week.json",
                    ]:
                        print(f"  contains {needle!r}: {needle in text}")
        except urllib.error.HTTPError as e:
            print(f"HTTP {e.code} {url}")
        except Exception as e:
            print(f"ERROR {url}: {e}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--site", type=Path, help="Path to the golfmdvip-site checkout")
    ap.add_argument("--commit", action="store_true", help="Commit snapshot/pointer/picks if they changed")
    ap.add_argument("--push", action="store_true", help="Push HEAD to origin (implies --commit)")
    ap.add_argument("--verify", action="store_true", help="HTTP-check the live golfmdvip.net pages after writing")
    ap.add_argument("--verify-only", action="store_true", help="Only check the live site; do not refresh")
    args = ap.parse_args()
    if args.verify_only:
        verify_live()
        return 0
    if args.push:
        args.commit = True

    site = find_site(args.site)
    picks_path = site / PICKS_REL
    if not picks_path.exists():
        raise SystemExit(f"Missing {picks_path}. Run build_w13_picks.py first.")
    week = json.loads(picks_path.read_text(encoding="utf-8"))
    if "@" in json.dumps(week):
        raise SystemExit("Picks file appears to contain an email address; aborting.")

    print(f"Site: {site}")
    print("Fetching ESPN scoreboards for 2026-11-27 and 2026-11-28…")
    payloads = []
    for url in ESPN_URLS:
        payload = fetch_json(url)
        date = url.split("dates=")[1].split("&")[0]
        raw_path = CACHE_DIR / f"espn_{date}.json"
        raw_path.write_text(json.dumps(payload), encoding="utf-8")
        print(f"  {date}: {len(payload.get('events') or [])} events")
        payloads.append(payload)
    espn = merge_espn(payloads)
    result = grade_with_node(site, week, espn, CACHE_DIR)
    snap = result["snap"]
    if "@" in json.dumps(snap):
        raise SystemExit("Snapshot would contain '@'; aborting.")
    snap_path = site / SNAP_REL
    snap_path.write_text(json.dumps(snap, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    write_pointer(site)

    summary = result["boardSummary"]
    print(f"Wrote {snap_path}")
    print(f"As of {summary['asof']}: {summary['final']} final / {summary['started']} started / {summary['total']} entries")
    print(f"GolfDoc official {summary['golfdoc']} · live {summary['golfdocLive']} · beating him {summary['beating']} · max {summary['maxPoints']}")
    if summary.get("missing"):
        print("WARNING: unmatched ESPN games:", ", ".join(summary["missing"]))
    print("Games:")
    for g in result["games"]:
        print(f"  {g['short']:12} {g['phase']:5} {g['when']} | {g['score']} | {g['cover']}")
    print("Parlays:")
    for p in result["parlays"]:
        print(f"  {p['name']}: official={p['status']} live={p['liveStatus']} ({p['label']})")
    print("Top of the board (official pts, then LIVE*):")
    for r in result["top"]:
        print(f"  {r['rank']:>3} {r['callSign']:<28} pts={r['points']} live={r['live']} max={r['max']} vs={r['vs']}")

    maybe_commit_push(site, summary["asof"], summary["started"], summary["final"], args.commit, args.push)
    if args.verify:
        verify_live()
    return 0


if __name__ == "__main__":
    sys.exit(main())

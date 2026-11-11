#!/usr/bin/env python3
"""Rebuild the Beat the GolfDoc team rosters (btg-team-rosters.json) and the
"All teams" table on beat-the-golfdoc.html.

Inputs are PRIVATE exports that must never be committed:
  --standings  Drive read_file export of the H1 standings sheet
               (tabs as "## Tab name" followed by CSV): Team Aliases,
               Team Roster, Call Sign Overrides, Responses (private),
               Responses W10 (private).
  --week       Drive export of a weekly responses sheet (repeatable),
               e.g. Week 11 "Form Responses 3".  Format: path[:tab name].
  --form-url   Public viewform URL; its Team / Affiliation choices are the
               official team list (optional but recommended).
  --extra-team Team to list even with no signups yet (repeatable).

Graded stats (season avg, week points) are carried over from the existing
btg-team-rosters.json, so rerunning is safe.  Output contains call signs and
public points only: no names, emails or phone numbers.

Usage:
  python3 scripts/build_btg_team_rosters.py --standings /tmp/h1.md \
      --week "/tmp/w11.md:Form Responses 3" --form-url URL --extra-team Concentra
"""
import argparse, csv, html, io, json, re, sys, unicodedata, urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JSON_PATH = ROOT / 'btg-team-rosters.json'
PAGE = ROOT / 'beat-the-golfdoc.html'
START, END = '<!-- BTG-ALL-TEAMS:START -->', '<!-- BTG-ALL-TEAMS:END -->'
# Built-in aliases on top of the sheet's Team Aliases tab.
BUILTIN_ALIAS = {'argo': 'ARGOS', '4 horsemen': 'The Four Horseman',
                 'four horsemen': 'The Four Horseman', 'the four horsemen': 'The Four Horseman'}
EMAIL_RE = re.compile(r'[^\s@]+@[^\s@]+\.[^\s@]+')
PHONE_RE = re.compile(r'\+?\d[\d\s().-]{6,}\d')


def tabs(path):
    txt = Path(path).read_text(encoding='utf-8')
    out = {}
    for m in re.finditer(r'^## (.+?)\n(.*?)(?=^## |\Z)', txt, re.S | re.M):
        out[m.group(1).strip()] = list(csv.reader(io.StringIO(m.group(2).strip('\n'))))
    return out


def clean(s):
    s = (s or '').replace('\u2019', "'").replace('â€™', "'")
    return s.strip().strip(',').strip()


def clean_team(s):
    return clean((s or '').replace('\u201d', "'"))


def key(s):
    return re.sub(r'\s+', ' ', clean_team(s)).lower()


def cs_key(s):
    s = unicodedata.normalize('NFKD', clean(s))
    return re.sub(r'[^a-z0-9]', '', s.lower())


def norm_email(e):
    e = (e or '').strip().lower()
    if e.endswith('@gmail.com'):
        local = e.split('@')[0].split('+')[0].replace('.', '')
        e = local + '@gmail.com'
    return e


def safe_call(c):
    c = clean(c)
    if not c or EMAIL_RE.search(c) or PHONE_RE.search(c):
        return ''
    return c


def form_teams(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        s = r.read().decode('utf-8')
    d = json.loads(re.search(r'FB_PUBLIC_LOAD_DATA_ = (.*?);</script>', s, re.S).group(1))
    for it in d[1][1]:
        if it[1] and it[1].startswith('Team'):
            return [clean(o[0]) for o in it[4][0][1] if clean(o[0]) and clean(o[0]) != 'No Team']
    return []


def season_table(page):
    """team -> (season_avg, weeks) from the existing 'Season · Provisional' table."""
    s = page.split('Season · Provisional', 1)
    if len(s) < 2:
        return {}
    body = s[1].split('</tbody>', 1)[0]
    out = {}
    for tr in re.findall(r'<tr>(.*?)</tr>', body, re.S):
        tds = [re.sub(r'<[^>]+>', '', t) for t in re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S)]
        if len(tds) >= 5:
            out[html.unescape(tds[1]).strip()] = (html.unescape(tds[2]).strip(), html.unescape(tds[4]).strip())
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--standings', required=True)
    ap.add_argument('--week', action='append', default=[])
    ap.add_argument('--form-url')
    ap.add_argument('--extra-team', action='append', default=[])
    ap.add_argument('--report', help='write a PRIVATE member report (names+emails) here, outside the repo')
    a = ap.parse_args()

    h1 = tabs(a.standings)
    official = form_teams(a.form_url) if a.form_url else []
    canon = {}  # key -> display name

    def add_team(t):
        t = clean(t)
        if t and t != 'No Team':
            canon.setdefault(key(t), t)
    for t in official + a.extra_team:
        add_team(t)

    alias = {k: v for k, v in BUILTIN_ALIAS.items()}
    for row in h1.get('Team Aliases', [])[1:]:
        if len(row) >= 2 and clean(row[0]) and clean(row[1]):
            alias[key(row[0])] = clean(row[1])

    for ak, target in list(alias.items()):
        if ak in canon and key(target) != ak and key(target) in canon:
            del canon[ak]

    def resolve(t):
        k = key(t)
        if k in alias:
            k = key(alias[k])
        return canon.get(k)

    for row in h1.get('Team Roster', [])[1:]:
        for t in re.split(r',\s*', row[1] if len(row) > 1 else ''):
            if clean(t):
                add_team(alias.get(key(t), t))

    old = json.loads(JSON_PATH.read_text()) if JSON_PATH.exists() else {'teams': {}}
    graded = {}  # canonical name -> list of graded players
    for name, entry in old.get('teams', {}).items():
        players = [p for p in entry.get('players', []) if p.get('weeks_played')]
        if not players:
            continue
        t = resolve(name)
        if not t:
            add_team(alias.get(key(name), name))
            t = resolve(name)
        graded.setdefault(t, []).extend(players)

    people = {}  # email -> dict(name, calls[list], teams[set])
    unknown_writeins = {}

    def person(e):
        return people.setdefault(e, {'name': '', 'calls': [], 'teams': set()})

    def ingest(rows, label):
        if not rows:
            return
        hdr = rows[0]
        ti = max(i for i, x in enumerate(hdr) if x.startswith('Team / Aff'))
        for row in rows[1:]:
            if len(row) < 4:
                continue
            em, nm, cs = row[1], row[2], row[3]
            if '@' not in em and '@' in nm:  # shifted row
                em, nm = nm, em
            if '@' not in em:
                continue
            p = person(norm_email(em))
            if clean(nm) and '@' not in nm:
                p['name'] = clean(nm)
            if safe_call(cs):
                p['calls'].append(safe_call(cs))
            cell = row[ti] if len(row) > ti else ''
            for t in re.split(r',\s*(?=\S)', cell):
                if not clean(t) or clean(t) == 'No Team':
                    continue
                r = resolve(t)
                if r:
                    p['teams'].add(r)
                else:
                    unknown_writeins.setdefault(clean(t), set()).add(label)

    ingest(h1.get('Responses (private)'), 'W9')
    ingest(h1.get('Responses W10 (private)'), 'W10')
    for spec in a.week:
        path, _, tab = spec.partition(':')
        t = tabs(path)
        ingest(t.get(tab) if tab else next(iter(t.values())), tab or path)
    for row in h1.get('Team Roster', [])[1:]:
        if len(row) > 1 and '@' in row[0]:
            p = person(norm_email(row[0]))
            for t in re.split(r',\s*', row[1]):
                r = resolve(t) if clean(t) else None
                if r:
                    p['teams'].add(r)
    for row in h1.get('Call Sign Overrides', [])[1:]:
        if len(row) > 1 and '@' in row[0] and safe_call(row[1]):
            person(norm_email(row[0]))['calls'].append(safe_call(row[1]))

    season = season_table(PAGE.read_text(encoding='utf-8'))
    season_by_key = {key(alias.get(key(k), k)): v for k, v in season.items()}

    teams_out, report = {}, {}
    for k, tname in sorted(canon.items(), key=lambda kv: kv[1].lower()):
        gp = graded.get(tname, [])
        members, used = [], set()
        for em, p in people.items():
            if tname not in p['teams']:
                continue
            ck = {cs_key(c) for c in p['calls']}
            match = next((g for i, g in enumerate(gp) if i not in used and cs_key(g.get('call_sign')) in ck), None)
            if match:
                used.add(gp.index(match))
            call = p['calls'][-1] if p['calls'] else (match or {}).get('call_sign') or 'Signed up (call sign pending)'
            m = {'call_sign': call}
            if match:
                for f in ('season_avg', 'total_points', 'weeks_played', 'week10_points'):
                    m[f] = match.get(f)
            members.append(m)
            report.setdefault(tname, []).append((p['name'], call, em))
        for i, g in enumerate(gp):  # graded players with no signup row on file
            if i not in used and not any(cs_key(m['call_sign']) == cs_key(g.get('call_sign')) for m in members):
                members.append({f: g.get(f) for f in ('call_sign', 'season_avg', 'total_points', 'weeks_played', 'week10_points')})
                report.setdefault(tname, []).append(('(graded only)', g.get('call_sign'), ''))
        dedup = {}
        for m in members:
            dk = cs_key(m['call_sign']) or m['call_sign']
            if dk not in dedup or (m.get('weeks_played') and not dedup[dk].get('weeks_played')):
                dedup[dk] = m
        members = list(dedup.values())
        members.sort(key=lambda m: (-(m.get('season_avg') or -1), m['call_sign'].lower()))
        s_avg, s_wk = season_by_key.get(k, ('', ''))
        teams_out[tname] = {'name': tname, 'count': len(members), 'graded': bool(gp),
                            'season_avg': s_avg or None, 'players': members}

    aliases_out = {}
    for ak, target in alias.items():
        t = resolve(target)
        if t:
            aliases_out[ak] = t
    for name in old.get('teams', {}):
        t = resolve(name)
        if t and name != t:
            aliases_out[key(name)] = t

    out = {'generated_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
           'source': 'H1 standings sheet (Team Roster, aliases, W9/W10 responses) + weekly form responses + live form team list; graded stats carried from previous build',
           'privacy': 'call signs and public points only; no names, emails, phone numbers or raw sheet rows',
           'stats': {'teams': len(teams_out), 'graded_teams': sum(1 for t in teams_out.values() if t['graded']),
                     'players': len(people)},
           'aliases': aliases_out, 'teams': teams_out}
    blob = json.dumps(out, ensure_ascii=False, indent=1)
    assert not EMAIL_RE.search(blob), 'email leaked into public JSON'
    JSON_PATH.write_text(blob + '\n', encoding='utf-8')

    # Static "All teams" table (works without JavaScript).
    def num(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return None
    ranked = sorted(teams_out.values(), key=lambda t: (num(t['season_avg']) is None, -(num(t['season_avg']) or 0), t['name'].lower()))
    td = 'style="padding:7px 10px;border-bottom:1px solid rgba(255,255,255,.08)"'
    th = 'style="padding:8px 10px;text-align:left;color:var(--gold);border-bottom:2px solid var(--gold)"'
    rows = []
    for t in ranked:
        n = html.escape(t['name'])
        avg = f'<strong>{html.escape(t["season_avg"])}</strong>' if num(t['season_avg']) is not None else '<span style="opacity:.8">No graded picks yet · 0</span>'
        rows.append(f'<tr><td {td}><button type="button" class="btg-team-btn" data-btg-team="{n}" aria-haspopup="dialog">{n}</button></td>'
                    f'<td {td}>{t["count"]}</td><td {td}>{avg}</td></tr>')
    block = (f'{START}\n<h3 id="all-teams" style="margin-top:28px">All teams · who\'s signed up</h3>\n'
             f'<p style="opacity:.85">Every Beat the GolfDoc team, including new teams with no graded picks yet. '
             f'Tap a team to see its members by call sign. {len(teams_out)} teams.</p>\n'
             f'<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.95rem"><thead><tr>'
             f'<th {th}>Team</th><th {th}>Members</th><th {th}>Season avg</th></tr></thead><tbody>\n'
             + '\n'.join(rows) + f'\n</tbody></table></div>\n{END}')
    page = PAGE.read_text(encoding='utf-8')
    if START in page:
        page = re.sub(re.escape(START) + r'.*?' + re.escape(END), lambda m: block, page, flags=re.S)
    else:
        anchor = '<p style="margin-top:18px">Picks boards and Week 9'
        assert anchor in page, 'insertion anchor not found'
        page = page.replace(anchor, block + '\n' + anchor, 1)
    assert not EMAIL_RE.search(block)
    PAGE.write_text(page, encoding='utf-8')

    if a.report:
        with open(a.report, 'w', newline='') as f:
            w = csv.writer(f)
            w.writerow(['team', 'name', 'call_sign', 'email'])
            for t in sorted(report):
                for r in report[t]:
                    w.writerow([t] + list(r))
    print(f'{len(teams_out)} teams ({out["stats"]["graded_teams"]} graded), {len(people)} people')
    if unknown_writeins:
        print('Write-ins not on the team list (ignored):', {k: sorted(v) for k, v in unknown_writeins.items()})


if __name__ == '__main__':
    main()

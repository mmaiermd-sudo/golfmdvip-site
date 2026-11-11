#!/usr/bin/env python3
"""Add new Golden Helmets & Green Jackets uploads to the static site.

Reads the public YouTube RSS feed for @GoldenHelmetsandGreenJackets, skips any
video id already present in the site HTML, and inserts cards in the existing
markup. Existing pages are never regenerated and existing cards are never
removed. Running the script again adds nothing.

    python3 scripts/add_new_videos.py
"""

from __future__ import annotations

import datetime
import html
import http.client
import re
import sys
import time
import xml.etree.ElementTree as ET
import zoneinfo
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HANDLE = "@GoldenHelmetsandGreenJackets"
HANDLE_PATH = "/@GoldenHelmetsandGreenJackets"
CT = zoneinfo.ZoneInfo("America/Chicago")

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)
BROWSER = {"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"}

ATOM = "http://www.w3.org/2005/Atom"
YT_NS = "http://www.youtube.com/xml/schemas/2015"
MEDIA = "http://search.yahoo.com/mrss/"
NS = {"atom": ATOM, "yt": YT_NS, "media": MEDIA}

PLAY_ICON = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>'
YT_ICON = (
    '<svg viewBox="0 0 24 24"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6'
    "s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1"
    "c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8"
    'ZM9.6 15.6V8.4l6.3 3.6-6.3 3.6Z"/></svg>'
)

PAGE_NAMES = ("episodes.html", "shorts.html", "index.html")
EP_MENTION_RE = re.compile(
    r"\b(?:Episodes|Episode|Ep\.)\s+(\d+)(?:\s*(?:&|and)\s*(\d+))?"
    r"|\bEp\s+(\d+)\b",
    re.IGNORECASE,
)


@dataclass
class Video:
    id: str
    title: str
    published: datetime.datetime
    description: str
    kind: str = ""
    episode_number: int | None = None
    section: str | None = None
    duration: int | None = None
    thumb: str = ""


def http_get(host, path, retries=5, retry_statuses=(500, 502, 503), extra_headers=None):
    """HTTP/1.1 GET. YouTube's RSS server often 500s on HTTP/2, so this stays on 1.1."""
    headers = dict(BROWSER)
    if extra_headers:
        headers.update(extra_headers)
    last_error = None
    for attempt in range(retries):
        conn = http.client.HTTPSConnection(host, timeout=30)
        try:
            conn.request("GET", path, headers=headers)
            resp = conn.getresponse()
            body = resp.read()
            status = resp.status
            location = resp.getheader("Location")
            if status in retry_statuses and attempt + 1 < retries:
                time.sleep(0.7 * (attempt + 1))
                continue
            return status, location, body
        except (http.client.HTTPException, OSError, TimeoutError) as exc:
            last_error = exc
            if attempt + 1 >= retries:
                raise
            time.sleep(0.7 * (attempt + 1))
        finally:
            conn.close()
    raise RuntimeError(f"GET {host}{path} failed: {last_error}")


def resolve_channel_id():
    status, _, body = http_get("www.youtube.com", HANDLE_PATH)
    if status != 200:
        raise SystemExit(f"Could not open {HANDLE} (HTTP {status})")
    text = body.decode("utf-8", "replace")
    patterns = (
        r"channel_id=(UC[A-Za-z0-9_-]{22})",
        r"youtube\.com/channel/(UC[A-Za-z0-9_-]{22})",
        r'itemprop="identifier" content="(UC[A-Za-z0-9_-]{22})"',
    )
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return match.group(1)
    raise SystemExit(f"Could not resolve a channel id from {HANDLE}")


def fetch_feed(channel_id):
    """The public RSS endpoint occasionally answers 404 or 500; retry until XML comes back."""
    uploads = "UU" + channel_id[2:]
    paths = (
        f"/feeds/videos.xml?channel_id={channel_id}",
        f"/feeds/videos.xml?playlist_id={uploads}",
    )
    headers = {"Accept": "application/atom+xml,application/xml,text/xml,*/*;q=0.8"}
    status = 0
    attempts = 12
    for attempt in range(attempts):
        for path in paths:
            try:
                status, _, body = http_get(
                    "www.youtube.com",
                    path,
                    retries=1,
                    retry_statuses=(),
                    extra_headers=headers,
                )
            except (http.client.HTTPException, OSError, TimeoutError):
                status, body = 0, b""
            if status == 200 and body.lstrip().startswith(b"<?xml"):
                return parse_feed(body)
        if attempt + 1 < attempts:
            time.sleep(4)
    raise SystemExit(f"YouTube RSS feed returned HTTP {status}")


def parse_feed(xml_bytes):
    root = ET.fromstring(xml_bytes)
    videos = []
    seen = set()
    for entry in root.findall("atom:entry", NS):
        video_id = (entry.findtext("yt:videoId", default="", namespaces=NS) or "").strip()
        title = (entry.findtext("atom:title", default="", namespaces=NS) or "").strip()
        published = (entry.findtext("atom:published", default="", namespaces=NS) or "").strip()
        desc_el = entry.find("media:group/media:description", NS)
        description = (desc_el.text or "") if desc_el is not None else ""
        if not video_id or video_id in seen or not published:
            continue
        seen.add(video_id)
        videos.append(
            Video(
                id=video_id,
                title=title or video_id,
                published=datetime.datetime.fromisoformat(published),
                description=description,
            )
        )
    return videos


def site_html_texts():
    texts = []
    for path in sorted(ROOT.glob("*.html")):
        texts.append(path.read_text(encoding="utf-8"))
    return texts


def video_on_site(video_id, texts):
    pattern = re.compile(rf"(?<![A-Za-z0-9_-]){re.escape(video_id)}(?![A-Za-z0-9_-])")
    return any(pattern.search(text) for text in texts)


def load_pages():
    return {name: (ROOT / name).read_text(encoding="utf-8") for name in PAGE_NAMES}


def fmt_date(when):
    local = when.astimezone(CT)
    return f"{local.strftime('%b')} {local.day}, {local.year}"


def fmt_dur(seconds):
    seconds = int(seconds)
    hours, rem = divmod(seconds, 3600)
    minutes, secs = divmod(rem, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"


def esc(value):
    return html.escape(value or "", quote=True)


def clean_blurb(description):
    text = description or ""
    for marker in ("Beat the GolfDoc:", "Watch/subscribe:", "21+ |"):
        idx = text.find(marker)
        if idx > 0:
            text = text[:idx]
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"(https?://\S+)\s*$", "", text).strip()
    if len(text) > 360:
        text = text[:360].rsplit(" ", 1)[0].rstrip(".,;:") + "…"
    return text or "New from Golden Helmets & Green Jackets."


def watch(video_id):
    return f"https://www.youtube.com/watch?v={video_id}"


def episode_numbers(text):
    found = []
    for match in EP_MENTION_RE.finditer(text or ""):
        for group in match.groups():
            if group and int(group) not in found:
                found.append(int(group))
    return found


def title_episode_number(title):
    match = re.match(r"\s*Episode\s+(\d+)\b", title or "", re.IGNORECASE)
    return int(match.group(1)) if match else None


def episode_heading(title, number):
    rest = re.sub(
        rf"(?i)^\s*episode\s+{number}\s*[:,.\-–—]*\s*",
        "",
        title or "",
    ).strip()
    return rest or title


def parse_length(text, video_id):
    if not text:
        return None
    match = re.search(
        rf'"videoId":"{re.escape(video_id)}","title":"(?:\\.|[^"\\])*","lengthSeconds":"(\d+)"',
        text,
    )
    if not match:
        match = re.search(
            rf'"videoId":"{re.escape(video_id)}".{{0,500}}"lengthSeconds":"(\d+)"',
            text,
        )
    return int(match.group(1)) if match else None


def classify(video):
    """Shorts stay on /shorts/; other uploads redirect to /watch."""
    status, _, body = http_get("www.youtube.com", f"/shorts/{video.id}", retries=3)
    text = body.decode("utf-8", "replace") if body else ""
    is_short = status == 200 and (
        f'"videoId":"{video.id}"' in text or f"/shorts/{video.id}" in text
    )
    duration = parse_length(text, video.id) if is_short else None
    if not is_short:
        watch_status, _, watch_body = http_get(
            "www.youtube.com", f"/watch?v={video.id}", retries=2
        )
        if watch_status == 200 and watch_body:
            duration = parse_length(watch_body.decode("utf-8", "replace"), video.id)
    number = title_episode_number(video.title)
    if is_short:
        video.kind = "short"
    elif number is not None:
        video.kind = "episode"
        video.episode_number = number
    else:
        video.kind = "bonus"
    video.duration = duration
    return video


def thumb_url(video_id):
    """First i.ytimg.com image that returns a real 200, then hqdefault."""
    fallback = f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
    for name in ("maxresdefault", "sddefault", "hqdefault"):
        path = f"/vi/{video_id}/{name}.jpg"
        status, _, body = http_get("i.ytimg.com", path, retries=3)
        url = f"https://i.ytimg.com{path}"
        if status == 200 and body and (len(body) > 2000 or name == "hqdefault"):
            return url
    return fallback


def video_player(video):
    title = esc(video.title)
    dur = f'<span class="dur">{fmt_dur(video.duration)}</span>' if video.duration is not None else ""
    return (
        f'<div class="video" data-yt="{video.id}" style="background-image:url({video.thumb})" '
        f'role="group" aria-label="{title}">'
        f'<button class="play" type="button" aria-label="Play: {title}"><span>{PLAY_ICON}</span></button>'
        f"{dur}"
        f'<noscript><a href="{watch(video.id)}" target="_blank" rel="noopener">Watch on YouTube</a></noscript></div>'
    )


def short_card(video):
    title = esc(video.title)
    dur = f'<span class="dur">{fmt_dur(video.duration)}</span>' if video.duration is not None else ""
    return (
        f'<a class="short" href="https://www.youtube.com/shorts/{video.id}" target="_blank" rel="noopener">'
        f'<div class="t"><img loading="lazy" src="{video.thumb}" alt="{title}">{dur}</div>'
        f"<h4>{title}</h4><small>{fmt_date(video.published)}</small></a>"
    )


def bonus_card(video):
    title = esc(video.title)
    url = watch(video.id)
    eyebrow = fmt_date(video.published)
    if video.duration is not None:
        eyebrow += f" · {fmt_dur(video.duration)}"
    return (
        f'<article class="card"><a class="thumb" href="{url}" target="_blank" rel="noopener">'
        f'<img loading="lazy" src="{video.thumb}" alt="{title}"></a>\n'
        f'<div class="body"><span class="eyebrow">{eyebrow}</span>'
        f'<h3><a href="{url}" target="_blank" rel="noopener">{title}</a></h3>'
        f"<p>{esc(clean_blurb(video.description))}</p>"
        f'<a class="more" href="{url}" target="_blank" rel="noopener">Watch on YouTube →</a></div></article>'
    )


def episode_article(video):
    number = video.episode_number
    heading = esc(episode_heading(video.title, number))
    num = f"Episode {number} · {fmt_date(video.published)}"
    if video.duration is not None:
        num += f" · {fmt_dur(video.duration)}"
    return (
        f'<article class="episode" id="ep{number}">\n'
        f"  <div>{video_player(video)}</div>\n"
        f"  <div><span class=\"num\">{esc(num)}</span>\n"
        f"    <h3>{heading}</h3>\n"
        f"    <p>{esc(clean_blurb(video.description))}</p>\n"
        f'    <a class="btn btn-green" href="{watch(video.id)}" target="_blank" rel="noopener">{YT_ICON} Watch on YouTube</a>\n'
        f"  </div></article>"
    )


def latest_section(video):
    return (
        '<section class="dark"><div class="wrap latest">\n'
        f"  <div>{video_player(video)}</div>\n"
        f'  <div><span class="eyebrow" style="color:var(--gold-lt)">Latest episode · {fmt_date(video.published)}</span>\n'
        f"    <h2>{esc(video.title)}</h2>\n"
        f"    <p>{esc(clean_blurb(video.description))}</p>\n"
        f'    <div class="btns"><a class="btn btn-gold" href="{watch(video.id)}" target="_blank" rel="noopener">{YT_ICON} Watch on YouTube</a>'
        f'<a class="btn btn-ghost" href="episodes.html">All episodes</a></div>\n'
        "  </div>\n"
        "</div></section>"
    )


def heading_score(heading, number):
    if re.match(rf"Episode\s+{number}\b", heading, re.IGNORECASE):
        return 2
    if re.search(rf"\bEpisode\s+{number}\b", heading, re.IGNORECASE):
        return 2
    if re.search(rf"\bEpisodes\b.{{0,40}}\b{number}\b", heading, re.IGNORECASE):
        return 1
    return 0


def matching_short_heading(html_text, video):
    numbers = episode_numbers(video.title) or episode_numbers(video.description)
    if not numbers:
        return None
    best = None
    best_score = 0
    tied = False
    for match in re.finditer(r'<h3 class="subgroup">(.*?)</h3>', html_text):
        heading = html.unescape(match.group(1))
        score = max(heading_score(heading, number) for number in numbers)
        if score > best_score:
            best, best_score, tied = heading, score, False
        elif score == best_score and score > 0 and heading != best:
            tied = True
    if best_score == 0 or tied:
        return None
    return best


def prepend_after(html_text, start, marker, card):
    idx = html_text.find(marker, start)
    if idx < 0:
        return None
    pos = idx + len(marker)
    return html_text[:pos] + card + html_text[pos:]


def insert_short(html_text, video, card):
    heading = matching_short_heading(html_text, video)
    if heading:
        for match in re.finditer(r'<h3 class="subgroup">(.*?)</h3>', html_text):
            if html.unescape(match.group(1)) != heading:
                continue
            nxt = re.search(r'<h3 class="subgroup">', html_text[match.end():])
            window_end = match.end() + nxt.start() if nxt else len(html_text)
            updated = prepend_after(html_text[:window_end], match.end(), '<div class="shorts">', card)
            if updated is None:
                break
            video.section = heading
            return updated + html_text[window_end:]
    video.section = "Latest"
    if '<div class="group" id="latest">' not in html_text:
        wrap = html_text.find('<section><div class="wrap"><div class="group"')
        if wrap < 0:
            raise RuntimeError("shorts.html has no group to attach a Latest section to")
        pos = wrap + len('<section><div class="wrap">')
        block = (
            '<div class="group" id="latest"><h2>Latest</h2><div class="rule"></div>'
            f'<p>New Shorts from the channel.</p><div class="shorts">{card}</div></div>'
        )
        html_text = html_text[:pos] + block + html_text[pos:]
        if '<a href="#latest">' not in html_text:
            html_text = html_text.replace(
                '<div class="toc">',
                '<div class="toc"><a href="#latest">Latest</a>',
                1,
            )
        return html_text
    start = html_text.find('<div class="group" id="latest">')
    updated = prepend_after(html_text, start, '<div class="shorts">', card)
    if updated is None:
        raise RuntimeError("Latest Shorts section has no card list")
    return updated


def update_short_count(html_text):
    count = len(re.findall(r'<a class="short\b', html_text))
    updated, replaced = re.subn(
        r'(<span class="eyebrow">)\d+( Shorts</span>)',
        rf"\g<1>{count}\2",
        html_text,
        count=1,
    )
    if replaced != 1:
        raise RuntimeError('shorts.html is missing the "N Shorts" eyebrow')
    return updated


def insert_episode(html_text, video):
    number = video.episode_number
    if f'id="ep{number}"' in html_text:
        return None
    article = episode_article(video)
    marker = '<article class="episode"'
    idx = html_text.find(marker)
    if idx < 0:
        raise RuntimeError("episodes.html has no episode list")
    html_text = html_text[:idx] + article + html_text[idx:]
    toc_link = f'<a href="#ep{number}">Ep. {number}</a>'
    if toc_link not in html_text:
        html_text = html_text.replace('<div class="toc">', '<div class="toc">' + toc_link, 1)
    return html_text


def insert_bonus(html_text, video, card):
    locks = re.search(r"\b(locks|picks)\b", video.title or "", re.IGNORECASE)
    if locks:
        for match in re.finditer(r'<h3 class="subgroup">(.*?)</h3>', html_text):
            heading = html.unescape(match.group(1))
            if "Locks" not in heading:
                continue
            nxt = re.search(r'<h3 class="subgroup">', html_text[match.end():])
            window_end = match.end() + nxt.start() if nxt else len(html_text)
            updated = prepend_after(html_text[:window_end], match.end(), '<div class="grid">', card)
            if updated is None:
                break
            video.section = heading
            return updated + html_text[window_end:]
    video.section = "Latest"
    existing = '<h3 class="subgroup">Latest</h3><div class="grid">'
    if existing in html_text:
        return html_text.replace(existing, existing + card, 1)
    bonus = html_text.find('id="bonus"')
    if bonus < 0:
        raise RuntimeError("episodes.html has no bonus section")
    rule = html_text.find('<div class="rule"></div>', bonus)
    if rule < 0:
        raise RuntimeError("bonus section has no rule")
    pos = rule + len('<div class="rule"></div>')
    block = f'<h3 class="subgroup">Latest</h3><div class="grid">{card}</div>'
    return html_text[:pos] + block + html_text[pos:]


def current_latest_episode_number(html_text):
    start = html_text.find('<div class="wrap latest">')
    if start < 0:
        return None
    end = html_text.find("</div></section>", start)
    chunk = html_text[start:end if end > 0 else start + 2000]
    match = re.search(r"<h2>(.*?)</h2>", chunk, re.DOTALL)
    if not match:
        return None
    return title_episode_number(html.unescape(match.group(1)))


def replace_latest(html_text, video):
    start = html_text.find('<section class="dark"><div class="wrap latest">')
    if start < 0:
        raise RuntimeError("index.html has no latest section")
    end = html_text.find("</div></section>", start)
    if end < 0:
        raise RuntimeError("index.html latest section is unfinished")
    end += len("</div></section>")
    return html_text[:start] + latest_section(video) + html_text[end:]


def insert_home_short(html_text, card):
    marker = "<h2>Quick hits</h2>"
    start = html_text.find(marker)
    if start < 0:
        raise RuntimeError("index.html has no Quick hits section")
    updated = prepend_after(html_text, start, '<div class="shorts">', card)
    if updated is None:
        raise RuntimeError("index.html Quick hits has no Shorts list")
    return updated


def page_has(html_text, video_id):
    return re.search(
        rf"(?<![A-Za-z0-9_-]){re.escape(video_id)}(?![A-Za-z0-9_-])",
        html_text,
    ) is not None


def apply_additions(pages, videos):
    """Insert `videos` (oldest first) into page strings. Returns (pages, report)."""
    pages = dict(pages)
    report = []
    spotlight = None
    added_short = False
    ordered = sorted(videos, key=lambda video: video.published)
    for video in ordered:
        if any(page_has(text, video.id) for text in pages.values()):
            continue
        if video.kind == "short":
            card = short_card(video)
            pages["shorts.html"] = insert_short(pages["shorts.html"], video, card)
            pages["index.html"] = insert_home_short(pages["index.html"], card)
            added_short = True
            where = video.section or "Latest"
            report.append(f'short {video.id} "{video.title}" -> shorts.html ({where}), index.html quick hits')
        elif video.kind == "episode":
            updated = insert_episode(pages["episodes.html"], video)
            if updated is None:
                video.kind = "bonus"
                video.section = None
            else:
                pages["episodes.html"] = updated
                if spotlight is None or (video.episode_number or 0) >= (spotlight.episode_number or 0):
                    spotlight = video
                report.append(
                    f'episode {video.id} "{video.title}" -> episodes.html#ep{video.episode_number}'
                )
                continue
        if video.kind == "bonus":
            card = bonus_card(video)
            pages["episodes.html"] = insert_bonus(pages["episodes.html"], video, card)
            report.append(
                f'bonus {video.id} "{video.title}" -> episodes.html bonus ({video.section or "Latest"})'
            )
    if added_short:
        pages["shorts.html"] = update_short_count(pages["shorts.html"])
    if spotlight is not None:
        current = current_latest_episode_number(pages["index.html"])
        if current is None or (spotlight.episode_number or 0) > current:
            pages["index.html"] = replace_latest(pages["index.html"], spotlight)
            report.append(
                f'home latest -> episode {spotlight.episode_number} ({spotlight.id})'
            )
    return pages, report


def write_if_changed(name, original, updated):
    if original == updated:
        return False
    path = ROOT / name
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(updated, encoding="utf-8")
    tmp.replace(path)
    return True


def main():
    channel_id = resolve_channel_id()
    feed = fetch_feed(channel_id)
    if not feed:
        print(f"Channel {channel_id}: RSS feed was empty. Nothing to add.")
        return 0
    texts = site_html_texts()
    missing = [video for video in feed if not video_on_site(video.id, texts)]
    print(f"Channel: {channel_id}")
    print(f"Feed: {len(feed)} latest uploads ({HANDLE})")
    newest = feed[0]
    print(f"Newest in feed: {newest.id} {newest.title} ({fmt_date(newest.published)})")
    print(f"Already on the site: {len(feed) - len(missing)}")
    if not missing:
        print("Added: 0")
        return 0
    for video in missing:
        classify(video)
        video.thumb = thumb_url(video.id)
        print(f"New {video.kind}: {video.id} {video.title}")
    pages = load_pages()
    updated, report = apply_additions(pages, missing)
    changed = []
    for name in PAGE_NAMES:
        if write_if_changed(name, pages[name], updated[name]):
            changed.append(name)
    print(f"Added: {len(report)}")
    for line in report:
        print(f"  {line}")
    if changed:
        print("Updated: " + ", ".join(changed))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        sys.exit(1)

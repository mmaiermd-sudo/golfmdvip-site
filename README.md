# Golden Helmets & Green Jackets

Static site for [golfmdvip.net](https://golfmdvip.net), published with GitHub Pages from `main`.

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

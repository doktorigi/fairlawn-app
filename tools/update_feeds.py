"""Poll every feed listed in data/*.json and write data/feed.json.

Stdlib only so the GitHub Action needs no installs. Run: python tools/update_feeds.py
Self-check: python tools/update_feeds.py --test
"""
import datetime as dt
import email.utils
import html
import json
import pathlib
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
UA = "FairLawnResidentGuide/1.0 (+https://github.com/doktorigi/fairlawn-app)"
PER_SOURCE = 25
NEWS_DAYS = 60
EVENT_DAYS = 120
UTC = dt.timezone.utc
# school-calendar housekeeping that residents don't care about
NOISE = re.compile(r"^\s*([A-F] DAY|DAY [A-F1-6]|faculty meeting|staff meeting|.*set-?up/clean-?up)\s*$", re.I)


def clean(text, limit=280):
    text = html.unescape(re.sub(r"<[^>]+>", " ", text or ""))
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= limit else text[: limit - 1].rsplit(" ", 1)[0] + "…"


def norm(s):
    return re.sub(r"\W+", "", s.lower())


def parse_date(s):
    if not s:
        return None
    s = s.strip()
    try:
        d = email.utils.parsedate_to_datetime(s)
    except (TypeError, ValueError):
        try:
            d = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None
    return d if d.tzinfo else d.replace(tzinfo=UTC)


def local(tag):
    return tag.rsplit("}", 1)[-1]


def child(el, name):
    return next((c for c in el if local(c.tag) == name), None)


def text(el, name):
    c = child(el, name)
    return (c.text or "").strip() if c is not None else ""


def parse_xml(body):
    """RSS 2.0, RSS 1.0 (RDF) and Atom -> list of {title, link, date, summary}."""
    root = ET.fromstring(body)
    out = []
    for el in root.iter():
        kind = local(el.tag)
        if kind not in ("item", "entry"):
            continue
        link = text(el, "link")
        if not link:  # Atom: <link href=.../>
            for c in el:
                if local(c.tag) == "link" and c.get("rel", "alternate") == "alternate":
                    link = c.get("href", "")
                    break
        date = parse_date(text(el, "pubDate") or text(el, "published") or text(el, "updated") or text(el, "date"))
        out.append({
            "title": clean(text(el, "title"), 200),
            "link": link,
            "date": date.isoformat() if date else None,
            "summary": clean(text(el, "description") or text(el, "summary") or text(el, "content")),
        })
    return out


def ical_date(value):
    v = value.strip()
    try:
        if "T" in v:
            d = dt.datetime.strptime(v.rstrip("Z")[:15], "%Y%m%dT%H%M%S")
            # ponytail: TZID params ignored, non-UTC times treated as local wall time (fine for one-town calendars)
            return d.replace(tzinfo=UTC).isoformat() if v.endswith("Z") else d.isoformat()
        return dt.datetime.strptime(v[:8], "%Y%m%d").date().isoformat()
    except ValueError:
        return None


def parse_ical(body):
    lines = re.sub(r"\r?\n[ \t]", "", body).splitlines()  # unfold continuation lines
    out, ev = [], None
    for line in lines:
        if line == "BEGIN:VEVENT":
            ev = {}
        elif line == "END:VEVENT" and ev is not None:
            out.append(ev)
            ev = None
        elif ev is not None and ":" in line:
            key, val = line.split(":", 1)
            key = key.split(";", 1)[0]
            val = val.replace("\\,", ",").replace("\\n", " ").replace("\\;", ";")
            if key == "SUMMARY":
                ev["title"] = clean(val, 200)
            elif key == "DTSTART":
                ev["start"] = ical_date(val)
            elif key == "LOCATION":
                ev["location"] = clean(val, 120)
            elif key == "URL":
                ev["link"] = val.strip()
            elif key == "DESCRIPTION":
                ev["summary"] = clean(val)
    return out


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.read().decode("utf-8", "replace")


def sort_key(d):
    return d or ""


def run():
    feeds = []
    for f in sorted(DATA.glob("*.json")):
        if f.name != "feed.json":
            feeds += json.loads(f.read_text("utf-8")).get("feeds", [])
    seen, news, events, errors = set(), [], [], []
    now = dt.datetime.now(UTC)
    news_cut = (now - dt.timedelta(days=NEWS_DAYS)).isoformat()
    today, ev_cut = now.date().isoformat(), (now + dt.timedelta(days=EVENT_DAYS)).date().isoformat()
    for feed in feeds:
        url = feed["url"]
        if url in seen:
            continue
        seen.add(url)
        feed = dict(feed, name=re.sub(r"\s*\((iCal|RSS)\)", "", feed["name"]))
        try:
            body = fetch(url)
            if feed.get("type") == "ical" or body.lstrip().startswith("BEGIN:VCALENDAR"):
                got = [e for e in parse_ical(body) if e.get("start") and today <= e["start"][:10] <= ev_cut
                       and not NOISE.match(e.get("title", ""))]
                got.sort(key=lambda e: e["start"])
                events += [dict(e, source=feed["name"], category=feed.get("category", "")) for e in got[:PER_SOURCE]]
            else:
                must = feed.get("mustMention", "").lower()  # regional feeds: keep only items about Fair Lawn
                got = [i for i in parse_xml(body) if i["title"] and (i["date"] is None or i["date"] >= news_cut)
                       and must in (i["title"] + " " + i["summary"]).lower()]
                got.sort(key=lambda i: sort_key(i["date"]), reverse=True)
                news += [dict(i, source=feed["name"], category=feed.get("category", "")) for i in got[:PER_SOURCE]]
        except Exception as e:  # one dead feed must never block the rest
            errors.append({"source": feed["name"], "url": url, "error": f"{type(e).__name__}: {e}"[:200]})
    # same story syndicated by several outlets -> keep first
    uniq, titles = [], set()
    for i in sorted(news, key=lambda i: sort_key(i["date"]), reverse=True):
        k = norm(i["title"])[:60]
        if k not in titles:
            titles.add(k)
            uniq.append(i)
    # district calendar repeats school-level events -> keep first per (title, day)
    events = list({(norm(e["title"]), e["start"][:10]): e for e in reversed(events)}.values())
    events.sort(key=lambda e: e["start"])
    out = {"updated": now.isoformat(timespec="seconds"), "news": uniq, "events": events, "errors": errors}
    (DATA / "feed.json").write_text(json.dumps(out, indent=1, ensure_ascii=False), "utf-8")
    print(f"{len(uniq)} news, {len(events)} events, {len(errors)} failed feeds")
    for e in errors:
        print("  FAIL", e["source"], e["error"])


def test():
    rss = """<rss><channel><item><title>Pool &amp; park news</title><link>https://a/1</link>
      <pubDate>Mon, 19 Oct 2026 10:00:00 -0400</pubDate><description>&lt;p&gt;Hello  world&lt;/p&gt;</description></item></channel></rss>"""
    i = parse_xml(rss)[0]
    assert i["title"] == "Pool & park news" and i["link"] == "https://a/1" and i["summary"] == "Hello world", i
    assert i["date"].startswith("2026-10-19T10:00"), i
    atom = """<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>A</title>
      <link rel="alternate" href="https://b/2"/><updated>2026-10-18T12:00:00Z</updated></entry></feed>"""
    a = parse_xml(atom)[0]
    assert a["link"] == "https://b/2" and a["date"].startswith("2026-10-18T12:00"), a
    ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Council\\, regular\r\n meeting\r\nDTSTART;TZID=America/New_York:20261020T193000\r\nLOCATION:Borough Hall\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:Leaf pickup\r\nDTSTART;VALUE=DATE:20261101\r\nEND:VEVENT\r\nEND:VCALENDAR"
    e = parse_ical(ics)
    assert e[0]["title"] == "Council, regularmeeting" and e[0]["start"] == "2026-10-20T19:30:00", e
    assert e[1]["start"] == "2026-11-01", e
    assert NOISE.match("A DAY") and NOISE.match("Faculty Meeting") and not NOISE.match("Fall Concert"), "noise filter"
    print("ok")


if __name__ == "__main__":
    test() if "--test" in sys.argv else run()

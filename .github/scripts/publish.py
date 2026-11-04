"""Publish a ReChat tag release: body = that version's CHANGELOG_FA.md
section, then reuse tauri-action's own latest.json as the updater feed
(only replacing its notes with the changelog section so the update
dialog shows it) and upload it to the rolling `update-feed` release.
Run in CI with GH_TOKEN and TAG set."""

import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone

FA_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٫", "0123456789.")


def run(args, capture=True, check=True):
    r = subprocess.run(args, capture_output=capture, text=True)
    if check and r.returncode != 0:
        print(r.stdout, r.stderr, file=sys.stderr)
        raise SystemExit(f"command failed: {' '.join(args)}")
    return r.stdout


def main():
    tag = os.environ["TAG"]
    version = tag.lstrip("v")
    repo = os.environ.get("GITHUB_REPOSITORY", "thaarfknight-star/ReChat")

    changelog = open("CHANGELOG_FA.md", encoding="utf-8").read()
    sections = re.split(r"^## ", changelog, flags=re.M)[1:]
    body = None
    for sec in sections:
        header = sec.split("\n", 1)[0]
        norm = header.translate(FA_DIGITS)
        if version in norm:
            body = "## " + sec.split("\n## ", 1)[0].rstrip() + "\n"
            break
    if body is None:
        raise SystemExit(f"no CHANGELOG_FA.md section for {version}")

    # tauri-action's own updater feed: it already contains the correct
    # updater artifact + signature for this stack (modern Tauri signs
    # the installer itself, not a .zip). Reuse it, don't rebuild it.
    assets = json.loads(
        run(["gh", "release", "view", tag, "--json", "assets", "-q", ".assets"])
    )
    latest = next(
        (a for a in assets if a["name"] == "latest.json"), None
    )
    if latest is None:
        raise SystemExit("no latest.json updater feed on the release")
    # NOTE: gh's asset JSON exposes `id` as the node id (RA_...), which
    # the REST asset endpoint rejects with 404 — so download by name
    # instead of by id.
    run(["gh", "release", "download", tag, "--pattern", "latest.json",
         "--dir", "feeddl"])
    with open("feeddl/latest.json", encoding="utf-8") as f:
        feed_text = f.read()
    feed = json.loads(feed_text)
    if "windows-x86_64" not in feed.get("platforms", {}):
        raise SystemExit("latest.json has no windows-x86_64 platform")
    feed["notes"] = body
    feed["pub_date"] = datetime.now(timezone.utc).isoformat()
    with open("update-feed.json", "w", encoding="utf-8") as f:
        json.dump(feed, f, ensure_ascii=False, indent=2)

    with open("release-notes.md", "w", encoding="utf-8") as f:
        f.write(body)
    run(["gh", "release", "edit", tag, "--draft=false",
         "--notes-file", "release-notes.md"])

    exists = subprocess.run(
        ["gh", "release", "view", "update-feed"],
        capture_output=True, text=True,
    ).returncode == 0
    if not exists:
        run(["gh", "release", "create", "update-feed",
             "--title", "update-feed",
             "--notes", "Rolling Tauri updater feed for ReChat."])
    run(["gh", "release", "upload", "update-feed", "update-feed.json",
         "--clobber"])
    print(f"published {tag} + update-feed for {version}")


if __name__ == "__main__":
    main()

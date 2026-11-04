"""Publish a ReChat tag release: body = that version's CHANGELOG_FA.md
section, then reuse tauri-action's own latest.json as the updater feed
(only replacing its notes with the changelog section so the update
dialog shows it) and upload it to the rolling `update-feed` release.
DownBolt/LagSlice convention, applied here too: the update file also
goes INTO the versioned tag itself (update-feed.json as an asset of
the tag release), so every tag carries its own update file — and any
older tag missing it gets backfilled (best-effort, never fatal).
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


def soft(args):
    """Like run(), but raises RuntimeError (an Exception) instead of
    SystemExit, so best-effort blocks can catch it."""
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"command failed: {' '.join(args)}: "
                           f"{r.stdout} {r.stderr}")
    return r.stdout


def section_for(changelog, version):
    sections = re.split(r"^## ", changelog, flags=re.M)[1:]
    for sec in sections:
        header = sec.split("\n", 1)[0]
        norm = header.translate(FA_DIGITS)
        if version in norm:
            return "## " + sec.split("\n## ", 1)[0].rstrip() + "\n"
    return None


def build_feed(latest_path, body, pub_date):
    with open(latest_path, encoding="utf-8") as f:
        feed = json.load(f)
    if "windows-x86_64" not in feed.get("platforms", {}):
        raise SystemExit("latest.json has no windows-x86_64 platform")
    feed["notes"] = body
    feed["pub_date"] = pub_date
    return feed


def backfill_old_tags(changelog, current_tag):
    """Upload update-feed.json to older v* tags that lack it.

    Reconstructs each tag's feed from its own latest.json + its
    CHANGELOG_FA.md section + its release published date. Best-effort:
    any failure is logged and skipped, never failing the publish job.
    """
    try:
        tags = [
            r["tagName"]
            for r in json.loads(
                soft(["gh", "release", "list", "--limit", "100",
                      "--json", "tagName"])
            )
        ]
    except Exception as exc:  # noqa: BLE001 - best-effort only
        print(f"backfill: cannot list releases, skipping ({exc})")
        return
    for old_tag in tags:
        if not old_tag.startswith("v") or old_tag == current_tag:
            continue
        try:
            rel = json.loads(soft([
                "gh", "release", "view", old_tag,
                "--json", "assets,publishedAt",
            ]))
            if any(a["name"] == "update-feed.json"
                   for a in rel.get("assets", [])):
                continue
            old_version = old_tag.lstrip("v")
            body = section_for(changelog, old_version)
            if body is None:
                print(f"backfill: no changelog section for {old_tag}, skip")
                continue
            dl_dir = f"backfilldl/{old_tag}"
            soft(["gh", "release", "download", old_tag,
                  "--pattern", "latest.json", "--dir", dl_dir])
            feed = build_feed(f"{dl_dir}/latest.json", body,
                              rel.get("publishedAt", ""))
            out_path = f"{dl_dir}/update-feed.json"
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(feed, f, ensure_ascii=False, indent=2)
            soft(["gh", "release", "upload", old_tag, out_path, "--clobber"])
            print(f"backfill: uploaded update-feed.json to {old_tag}")
        except Exception as exc:  # noqa: BLE001 - best-effort only
            print(f"backfill: {old_tag} failed, skipping ({exc})")


def main():
    tag = os.environ["TAG"]
    version = tag.lstrip("v")
    repo = os.environ.get("GITHUB_REPOSITORY", "thaarfknight-star/ReChat")

    changelog = open("CHANGELOG_FA.md", encoding="utf-8").read()
    body = section_for(changelog, version)
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
    feed = build_feed("feeddl/latest.json", body,
                      datetime.now(timezone.utc).isoformat())
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
    # The update file ALSO goes into the versioned tag itself, so the
    # tag carries its own update (DownBolt/LagSlice convention). This
    # must not fail the job after a successful publish, so it is
    # best-effort here; the release-check cron verifies the asset.
    try:
        soft(["gh", "release", "upload", tag, "update-feed.json",
              "--clobber"])
        print(f"uploaded update-feed.json to {tag}")
    except Exception as exc:  # noqa: BLE001 - verified by cron
        print(f"WARNING: update-feed.json upload to {tag} failed ({exc})")
    backfill_old_tags(changelog, tag)
    print(f"published {tag} + update-feed for {version}")


if __name__ == "__main__":
    main()

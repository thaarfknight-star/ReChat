"""Publish a ReChat tag release: body = that version's CHANGELOG_FA.md
section, then build the Tauri updater feed and upload it to the rolling
`update-feed` release. Run in CI with GH_TOKEN and TAG set."""

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

    # Updater artifact: the .nsis.zip + its .sig from the draft release.
    assets = json.loads(
        run(["gh", "release", "view", tag, "--json", "assets", "-q", ".assets"])
    )
    zip_asset = next(
        (a for a in assets if a["name"].endswith(".nsis.zip")), None
    )
    if zip_asset is None:
        raise SystemExit("no .nsis.zip updater artifact on the release")
    sig_name = zip_asset["name"] + ".sig"
    sig_asset = next((a for a in assets if a["name"] == sig_name), None)
    if sig_asset is None:
        raise SystemExit(f"missing signature asset {sig_name}")
    sig = run(
        ["gh", "api", f"repos/{repo}/releases/assets/{sig_asset['id']}",
         "-H", "Accept: application/octet-stream"]
    ).strip()

    feed = {
        "version": version,
        "notes": body,
        "pub_date": datetime.now(timezone.utc).isoformat(),
        "platforms": {
            "windows-x86_64": {
                "signature": sig,
                "url": (
                    f"https://github.com/{repo}/releases/download/"
                    f"{tag}/{zip_asset['name']}"
                ),
            }
        },
    }
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

"""Bring the YouTube client profiles in the `core` submodule up to date.

Values copied from yt-dlp's current client table (its default clients are tv_samsung, visionos
and web). The submodule's visionOS profile is out of date and has no Samsung-TV profile, which
made stream requests fail for songs that need those fallback clients.
"""
import json
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as f:
    data = json.load(f)

profiles = data["profiles"]

profiles["VISIONOS"].update(
    {
        "clientVersion": "1.02",
        "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
        "osName": "visionOS",
        "osVersion": "26.5.23O471",
        "deviceMake": "Apple",
        "deviceModel": "RealityDevice17,1",
    }
)

# "Samsung TV" client, same version as the existing downgraded TV profile.
profiles["TVHTML5_DOWNGRADED"].update(
    {
        "userAgent": "Mozilla/5.0 (SMART-TV; Linux; Tizen 2.4.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/2.4.0 TV Safari/538.1",
        "osName": "Tizen",
        "osVersion": "2.4.0",
        "deviceMake": "Samsung",
        "deviceModel": "UKS9800",
    }
)

with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write("\n")
print("Patched", path)

# Webb Screen

A KDE Plasma 6 wallpaper plugin that keeps your desktop stocked with fresh
imagery from the James Webb Space Telescope.

[![License: GPL v3+](https://img.shields.io/badge/License-GPLv3+-blue.svg)](LICENSE)
![Plasma 6](https://img.shields.io/badge/KDE-Plasma%206-1d99f3)
![Pure QML](https://img.shields.io/badge/QML-no%20compilation-brightgreen)

New Webb releases from ESA/Webb, NASA Science, Flickr and MAST are merged into
one stream, deduplicated and sorted newest first. The plugin picks a picture,
downloads the largest variant that fits your download budget, and optionally
names it in a small card on the desktop. Nothing to compile — image downloads
and cache housekeeping run through `curl` on Plasma's `executable` data engine.

## Requirements

- KDE Plasma 6 (Qt 6 / KF6)
- `kpackagetool6` (`kf6-package` / `kpackage`) — to install the plugin
- `curl` and coreutils — used at runtime for downloads and cache pruning

## Install

```sh
git clone https://github.com/postadelmaga/WebbScreen.git
cd WebbScreen
./install.sh
systemctl --user restart plasma-plasmashell.service
```

Then right-click the desktop → *Configure Desktop and Wallpaper* → wallpaper
type **Webb Screen**.

`install.sh` upgrades an existing installation in place, so re-running it after
a `git pull` is enough. To remove the plugin and its image cache:

```sh
./uninstall.sh
```

## Sources

| Source | API key | Notes |
| --- | --- | --- |
| **ESA/Webb** (`esawebb.org`) | no | RSS image feed; the CDN serves `large` (full-resolution), `wallpaper5`, `wallpaper4` and `screen` variants. **The best source** — this is where the science releases land first. |
| **NASA Science — Webb** (`science.nasa.gov`) | no | `webbtelescope.org` (STScI) has been retired and now redirects here; its release stream lives on as a WordPress REST collection. Roughly 80 recent Webb releases, at up to native resolution. **The other best source.** |
| **Flickr — NASA's James Webb Space Telescope** (`50785054@N03`) | optional | Without a key the public photostream feed is used, which caps most photos at 1024 px. A free key from <https://www.flickr.com/services/apps/create> switches to `flickr.people.getPublicPhotos` with `url_o`/`url_6k`… and unlocks original resolution. |
| **NASA Image and Video Library** (`images-api.nasa.gov`) | no | The archive is agency-wide, so a plain "James Webb Space Telescope" query returns mostly clean-room and press-event photography. Two queries are merged instead — everything filed under the STScI centres, plus a broad query filtered down to astronomical subjects. In practice this yields only a handful of images (the July 2022 first-release set); NASA simply does not index the later science releases here. |
| **jwstapi.com** (MAST) | required | Community index of processed JWST products. Off by default: it needs a key, and it returns raw instrument previews rather than press-ready pictures. |

Each source can be switched on or off independently in the wallpaper settings.
All enabled sources are merged, deduplicated and sorted newest first.

## Update policy

Three modes, chosen in the wallpaper settings:

- **Rotate on a schedule** — a new picture every 5 seconds … 1 week. The very
  short intervals are there for trying the plugin out.
- **Only when a new image is published** — the wallpaper stays put until a
  source publishes something new.
- **Manually** — only via *Next Webb Image* in the desktop context menu.

Rotating and polling are two independent clocks. Rotation moves through the
images already fetched — the pool is reused for 15 minutes — so a 5 second
interval costs one download per change and never re-queries the APIs. The
sources are polled separately, on the *Check for new images every* interval,
and a switch only happens when one is actually due.

Independently of the mode, *Switch as soon as a source publishes a new image*
makes a fresh release take over immediately. You can also advance by hand at
any time from the desktop context menu.

Which picture gets chosen is configurable too: the most recent one not shown
yet, a random one, or always the most recent.

## What counts as an image

*Only real photographs* (on by default) leaves out artist concepts,
illustrations, infographics, diagrams, spectra and images with annotations
drawn on them. The sources name these plainly and consistently in the title —
`(artist's concept)`, `transmission spectrum`, `(annotated NIRCam image)` — so
that is what the filter matches on, plus the unambiguous phrases in the caption.
There is no structured field to use instead: the ESA feed carries no category,
and the `Artist Concept` term on science.nasa.gov sits on a post type whose REST
endpoint returns an empty body.

## History

The last 15 images are remembered — title, caption, credit, link, the cached
path and the exact variant URL — so stepping back works even after the cache
has pruned one: it is fetched again. Going back does not discard what is ahead;
showing a *new* image does, browser style.

## Resolution and cache

Each source offers the same picture in several sizes. Before downloading, the
plugin issues `HEAD` requests down the candidate list, biggest first, and takes
the first variant that fits the configured budget (25 MB by default — enough
for the full-resolution ESA/Webb releases, which run around 4000×4000).
*Skip small press thumbnails* additionally rejects anything under 300 KB.

science.nasa.gov renders its images on the fly and answers neither
`Content-Length` nor range requests, so the size of a variant cannot be probed
there. Its rendition widths are estimated from the pixel count instead
(PNG ≈ 1.6 bytes/pixel), such a variant is only picked once every measurable
one has been rejected, and the real size is re-checked after the download — a
variant that blew the budget is deleted and the next smaller one is tried.

Images are cached in `~/.cache/webbscreen/`; the *Keep on disk* setting bounds
how many are retained (20 by default, oldest pruned first). Rotating back onto
an image still on disk costs nothing — the download is skipped.

## Caption

A small card in a corner of the desktop (bottom right by default) names what
you are looking at: the subject title, a short description of it, and the
credit line. On by default; the description can be turned off on its own, and
the card can be moved to any of the four corners — or hidden entirely — in the
wallpaper settings.

## Desktop context menu

Right-click the desktop:

- **Previous Webb Image** — step back through the last 15 images
- **Next Webb Image** — forward through the history, or a new image once you are
  back at the end; straight from the cached pool either way
- **About "…"** — open the source's page for the current image
- **Open Wallpaper Image** — open the cached file
- **Save a Copy to Pictures** — copy it to `~/Pictures/WebbScreen/`

## Layout

```
package/
├── metadata.json                 KPackage manifest (Plasma/Wallpaper)
└── contents/
    ├── code/sources.js           the five providers + merge/sort/dedupe
    ├── code/commands.js          the shell commands (probe, download, prune)
    ├── config/main.xml           KConfigXT settings and persisted state
    └── ui/
        ├── main.qml              WallpaperItem: policy, download, display
        ├── config.qml            settings page
        ├── Shell.qml             async wrapper around the executable engine
        └── InfoOverlay.qml       optional on-desktop caption
```

`contents/code/sources.js` and `contents/code/commands.js` are plain JavaScript
with no QML dependencies, so both the providers and the generated shell
commands can be exercised outside Plasma; `main.qml` only wires them together.

## Notes and known limitations

- Metered-connection detection is not implemented; if you are on a capped
  link, use *Manually* or lower the download budget.
- QML's `XMLHttpRequest` has no timeout, so a stalled request would otherwise
  hang an update forever; a five-minute watchdog unblocks it.
- Plasma does not reload a wallpaper plugin while it is running: after an
  upgrade, restart plasmashell.

## Contributing

Bug reports and pull requests are welcome. Since everything is interpreted QML
and JavaScript, the edit cycle is `./install.sh` followed by a plasmashell
restart; `journalctl --user -f -u plasma-plasmashell.service` shows the plugin's
warnings.

## License

GPL-3.0-or-later — see [LICENSE](LICENSE).

The images themselves belong to their respective missions and carry their own
(generally permissive) terms: NASA/ESA/CSA/STScI. This project is not affiliated
with or endorsed by NASA, ESA, CSA or STScI.

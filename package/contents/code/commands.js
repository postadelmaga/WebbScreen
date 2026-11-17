/*
 * WebbScreen — the shell commands run through the executable data engine.
 * SPDX-FileCopyrightText: 2026 postadelmaga
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Kept apart from main.qml so they can be exercised without a running Plasma:
 * every builder takes a `quote` function (Shell.quote) and returns a string for
 * /bin/sh.
 */

/**
 * Walks `candidates` in preference order — biggest first — and prints
 * "<bytes> <url>" for the first usable one, exiting 1 when there is none.
 * A variant is usable when it answers 200 and either fits the budget or
 * declines to say how big it is.
 *
 * Servers that render images on the fly (assets.science.nasa.gov) answer
 * neither Content-Length nor range requests, and such a variant is reported
 * with a size of 0. Walking past it to look for a measurable one further down
 * would be four HEAD requests and four seconds on every science.nasa.gov
 * switch to arrive back at the same answer: a candidate list comes from a
 * single host, so if the first variant cannot be measured, none of them can.
 * Over-budget renditions are caught after the fact instead — downloadCommand
 * exits 3 and main.qml retries with the smaller candidates.
 */
function probeCommand(quote, userAgent, candidates, maxBytes, minBytes) {
    let command = "for u in";
    candidates.forEach(function (url) { command += " " + quote(url); });
    command += "; do "
        + "h=$(curl -sIL --max-time 20 -A " + quote(userAgent) + " \"$u\" 2>/dev/null); "
        + "c=$(printf '%s' \"$h\" | awk '{sub(/\\r$/,\"\")} /^HTTP\\//{c=$2} END{print c+0}'); "
        + "l=$(printf '%s' \"$h\" | awk '{sub(/\\r$/,\"\")} tolower($1)==\"content-length:\"{v=$2} END{print v+0}'); "
        + "if [ \"$c\" = \"200\" ]; then "
        + "if [ \"$l\" -le 0 ]; then printf '0 %s\\n' \"$u\"; exit 0; fi; "
        + "if [ \"$l\" -le " + maxBytes + " ] && [ \"$l\" -ge " + minBytes + " ]; "
        + "then printf '%s %s\\n' \"$l\" \"$u\"; exit 0; fi; "
        + "fi; "
        + "done; exit 1";
    return command;
}

/**
 * Defines the shell function `large_enough FILE`, which measures the image and
 * succeeds when it is drawn on this screen without being enlarged — the same
 * rule as largeEnough() in sources.js, applied to the real pixels rather than
 * to what a source claims. `floor` is { width, height, fillsScreen } in
 * physical pixels, or null to accept anything.
 *
 * `file` reports the size of every format the sources serve. A JPEG line
 * also carries the pixel density ("density 1x1") ahead of the size, hence the
 * two-digit minimum and the last match. Two pixels of rounding are let
 * through; without `file`, or when it cannot tell, the image passes.
 */
function largeEnoughFunction(floor) {
    if (!floor) {
        return "large_enough() { return 0; }; ";
    }
    const join = floor.fillsScreen ? " && " : " || ";
    return "large_enough() { "
        + "command -v file >/dev/null 2>&1 || return 0; "
        + "d=$(file -b -- \"$1\" 2>/dev/null | grep -oE '[0-9]{2,} ?x ?[0-9]{2,}' | tail -n 1 | tr -d ' '); "
        + "[ -n \"$d\" ] || return 0; "
        + "[ $((${d%x*} + 2)) -ge " + Math.floor(floor.width) + " ]" + join
        + "[ $((${d#*x} + 2)) -ge " + Math.floor(floor.height) + " ]; }; ";
}

/**
 * Resolves what to put on screen for an entry: the copy already in the cache
 * if there is one large enough for the screen, otherwise the best variant to
 * fetch. Prints either "cached <path>" or probeCommand's "<bytes> <url>".
 *
 * A cached copy too small for the screen — fetched for a smaller one, or
 * before a fill mode that needs more — is deleted, so that the download
 * replaces it instead of finding it in the way.
 *
 * Rotating back onto a picture still on disk used to walk the whole candidate
 * list with a HEAD request each before finding out that the download would be
 * skipped anyway — several round trips to a CDN, every time, for a file
 * sitting in ~/.cache. The lookup costs one glob in the shell that was going
 * to be started regardless.
 *
 * cacheStem() leaves nothing the shell or the glob would treat as special,
 * which is what lets the stem sit unquoted next to the directory.
 */
function resolveCommand(quote, userAgent, candidates, maxBytes, minBytes, cacheDir, entryId, floor) {
    return largeEnoughFunction(floor)
        + "for f in " + quote(cacheDir) + "/" + cacheStem(entryId) + ".*; do "
        + "case \"$f\" in *.part) continue;; esac; "
        + "[ -s \"$f\" ] || continue; "
        + "if large_enough \"$f\"; then printf 'cached %s\\n' \"$f\"; exit 0; fi; "
        + "rm -f -- \"$f\"; "
        + "done; "
        + probeCommand(quote, userAgent, candidates, maxBytes, minBytes);
}

/// True when a resolveCommand result names a file already in the cache.
function resolvedFromCache(stdout) {
    return /^cached\s/.test(String(stdout).trim());
}

/// Parses a probeCommand result into the chosen URL, or "" when there is none.
function probeResultUrl(stdout) {
    const line = String(stdout).trim();
    if (line.length === 0) {
        return "";
    }
    return line.split(/\s+/).slice(1).join(" ");
}

/**
 * Downloads `url` into `destination` via a scratch file, unless it is already
 * there (a history step may land on a file that was never pruned).
 *
 * The scratch name carries the shell's PID so that two downloads landing on the
 * same file cannot tread on each other; combined with the atomic rename, the
 * worst a collision can cost is a duplicate transfer, never a torn file.
 *
 * Exit codes: 0 done, 1 cache directory unusable, 2 transfer failed,
 * 3 the variant is over budget (curl exits 63 on --max-filesize; the trailing
 * wc check catches servers that stream without announcing a length up front),
 * 4 the image is smaller than the screen needs (see largeEnoughFunction;
 * `floor` may be omitted to accept any size).
 */
function downloadCommand(quote, userAgent, cacheDir, url, destination, maxBytes, floor) {
    const quotedDestination = quote(destination);
    return largeEnoughFunction(floor || null)
        + "mkdir -p " + quote(cacheDir) + " || exit 1; "
        + "if [ -s " + quotedDestination + " ]; then exit 0; fi; "
        + "tmp=" + quotedDestination + "\".$$.part\"; "
        + "curl -sfL --max-time 240 --max-filesize " + maxBytes
        + " -A " + quote(userAgent)
        + " -o \"$tmp\" " + quote(url) + "; rc=$?; "
        + "if [ \"$rc\" -ne 0 ]; then rm -f \"$tmp\"; "
        + "[ \"$rc\" -eq 63 ] && exit 3; exit 2; fi; "
        + "sz=$(wc -c < \"$tmp\" 2>/dev/null || echo 0); "
        + "if [ \"$sz\" -gt " + maxBytes + " ]; then rm -f \"$tmp\"; exit 3; fi; "
        + "if ! large_enough \"$tmp\"; then rm -f \"$tmp\"; exit 4; fi; "
        + "mv -f \"$tmp\" " + quotedDestination;
}

/// Keeps the `keep` most recent images plus `keepFileName`, and sweeps stale
/// .part files left behind by interrupted downloads.
function pruneCommand(quote, cacheDir, keep, keepFileName) {
    return "cd " + quote(cacheDir) + " 2>/dev/null || exit 0; "
        + "find . -maxdepth 1 -name '*.part' -mmin +60 -delete 2>/dev/null; "
        + "ls -1t 2>/dev/null | grep -v '\\.part$' | tail -n +" + (keep + 1) + " | "
        + "while IFS= read -r f; do [ \"$f\" = " + quote(keepFileName) + " ] || rm -f -- \"$f\"; done";
}

function saveCopyCommand(quote, source, targetDir, name) {
    return "mkdir -p " + quote(targetDir) + " && "
        + "cp -n " + quote(source) + " " + quote(targetDir + "/" + name);
}

function clearCacheCommand() {
    return "rm -rf -- \"${XDG_CACHE_HOME:-$HOME/.cache}/webbscreen\"";
}

/// The cache file name for an entry, minus the extension: every variant of
/// the same image shares it, so it doubles as the glob for "do we already
/// have this one?". Reduced to characters no shell and no glob reads as
/// special.
function cacheStem(entryId) {
    return String(entryId).replace(/[^A-Za-z0-9._-]/g, "_");
}

/// Cache file name for an entry, derived from its id and the chosen variant.
function cacheFileName(entryId, url) {
    const ext = String(url).match(/\.(jpe?g|png|tiff?|webp)(?:[?#]|$)/i);
    return cacheStem(entryId) + (ext ? "." + ext[1].toLowerCase() : ".jpg");
}

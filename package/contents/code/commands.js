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
 * Walks `candidates` biggest first and prints "<bytes> <url>" for the first one
 * that fits the budget, exiting 1 when none does.
 *
 * Servers that render images on the fly (assets.science.nasa.gov) answer
 * neither Content-Length nor range requests. Such a variant is remembered as a
 * fallback, reported with a size of 0, and only used once every measurable
 * variant has been rejected.
 */
function probeCommand(quote, userAgent, candidates, maxBytes, minBytes) {
    let command = "best=''; for u in";
    candidates.forEach(function (url) { command += " " + quote(url); });
    command += "; do "
        + "h=$(curl -sIL --max-time 20 -A " + quote(userAgent) + " \"$u\" 2>/dev/null); "
        + "c=$(printf '%s' \"$h\" | awk '{sub(/\\r$/,\"\")} /^HTTP\\//{c=$2} END{print c+0}'); "
        + "l=$(printf '%s' \"$h\" | awk '{sub(/\\r$/,\"\")} tolower($1)==\"content-length:\"{v=$2} END{print v+0}'); "
        + "if [ \"$c\" = \"200\" ]; then "
        + "if [ \"$l\" -gt 0 ]; then "
        + "if [ \"$l\" -le " + maxBytes + " ] && [ \"$l\" -ge " + minBytes + " ]; "
        + "then printf '%s %s\\n' \"$l\" \"$u\"; exit 0; fi; "
        + "elif [ -z \"$best\" ]; then best=\"$u\"; fi; fi; "
        + "done; "
        + "if [ -n \"$best\" ]; then printf '0 %s\\n' \"$best\"; exit 0; fi; exit 1";
    return command;
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
 * cached — rotating back onto an image still on disk then costs nothing.
 *
 * The scratch name carries the shell's PID so that two downloads landing on the
 * same file cannot tread on each other; combined with the atomic rename, the
 * worst a collision can cost is a duplicate transfer, never a torn file.
 *
 * Exit codes: 0 done, 1 cache directory unusable, 2 transfer failed,
 * 3 the variant is over budget (curl exits 63 on --max-filesize; the trailing
 * wc check catches servers that stream without announcing a length up front).
 */
function downloadCommand(quote, userAgent, cacheDir, url, destination, maxBytes) {
    const quotedDestination = quote(destination);
    return "mkdir -p " + quote(cacheDir) + " || exit 1; "
        + "if [ -s " + quotedDestination + " ]; then exit 0; fi; "
        + "tmp=" + quotedDestination + "\".$$.part\"; "
        + "curl -sfL --max-time 240 --max-filesize " + maxBytes
        + " -A " + quote(userAgent)
        + " -o \"$tmp\" " + quote(url) + "; rc=$?; "
        + "if [ \"$rc\" -ne 0 ]; then rm -f \"$tmp\"; "
        + "[ \"$rc\" -eq 63 ] && exit 3; exit 2; fi; "
        + "sz=$(wc -c < \"$tmp\" 2>/dev/null || echo 0); "
        + "if [ \"$sz\" -gt " + maxBytes + " ]; then rm -f \"$tmp\"; exit 3; fi; "
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

/// Cache file name for an entry, derived from its id and the chosen variant.
function cacheFileName(entryId, url) {
    const stem = String(entryId).replace(/[^A-Za-z0-9._-]/g, "_");
    const ext = String(url).match(/\.(jpe?g|png|tiff?|webp)(?:[?#]|$)/i);
    return stem + (ext ? "." + ext[1].toLowerCase() : ".jpg");
}

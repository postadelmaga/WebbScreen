/*
 * WebbScreen — metadata providers.
 * SPDX-FileCopyrightText: 2026 postadelmaga
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Every provider normalises its results into entries shaped like:
 *   {
 *     id:          "esa:potm2608c",           // stable, unique across sources
 *     source:      "esa",
 *     sourceName:  "ESA/Webb",
 *     title:       "Arp 263",
 *     description: "plain text, already stripped of markup",
 *     credit:      "ESA/Webb, NASA & CSA",
 *     infoUrl:     "https://esawebb.org/images/potm2608c/",
 *     date:        1756281600000,             // ms since epoch, 0 when unknown
 *     candidates:  ["https://…large.jpg", …]  // ordered biggest first
 *     mediaText:   "Artist's concept of the …",            // optional
 *     instrument:  "NIRCam",                               // optional
 *   }
 *
 * `mediaText` and `instrument` exist only for the filters in fetchAll() and are
 * dropped once those have run. `mediaText` is the full, untruncated caption:
 * the sentence that gives an illustration away is often the credit line at the
 * very end.
 *
 * Nothing here touches the filesystem: main.qml probes the candidates and
 * picks the largest one that fits the configured download budget.
 */

var UA = "Mozilla/5.0 (X11; Linux x86_64) WebbScreen/1.0 (KDE Plasma wallpaper)";

var ESA_FEED = "https://esawebb.org/images/feed/";
// "large" is the release JPEG at its own size, which the feed does not state;
// the download is measured instead. The wallpaper sizes are fixed crops cut
// from it, enlarged when it is smaller than they are. "screen" keeps the
// aspect and is 1280 wide.
var ESA_VARIANTS = [
    { name: "large", width: Infinity },
    { name: "wallpaper5", width: 2048, height: 1536 },
    { name: "wallpaper4", width: 1920, height: 1200 },
    { name: "screen", width: 1280 }
];

// webbtelescope.org (STScI) now redirects to science.nasa.gov. Its WordPress
// REST API publishes every picture of a release as a separate "stma" (science
// asset), titled for what it shows — "Cat's Head Nebula (Webb NIRCam Image)" —
// and filed under a science-org taxonomy that already tells photographs from
// artwork, infographics, spectra and videos.
var NASA_SCIENCE_API = "https://science.nasa.gov/wp-json/wp/v2/stma";
var NASA_SCIENCE_IMAGES = 20138; // science-org "webb-images": every still, no videos
// science-org terms that are not photographs of the sky: artist concepts,
// infographics, spectra, side-by-side comparisons, engineering photos.
var NASA_SCIENCE_NOT_PHOTOS = [22779, 22699, 22758, 22670, 22666];
var NASA_SCIENCE_WIDTHS = [3840, 2560, 1920, 1440];

var JWST_API = "https://api.jwstapi.com/all/type/jpg";

// Not every release is a photograph. Three vocabularies, each matched against
// the text it suits, because the same word carries a different weight
// depending on where it appears:
//
//   NON_PHOTO_TITLE  Titles follow a tight convention across all the sources —
//                    "(artist's concept)", "transmission spectrum", "(annotated
//                    NIRCam image)", "(Compass Image)". A title naming the
//                    medium is decisive, so this one casts the widest net.
//
//   NON_PHOTO_MEDIUM Image captions describe the medium in prose: "An
//                    illustration of…", "Artist's concept of…". Bare
//                    "illustration" is safe here, but "spectrum", "annotated"
//                    and "simulation" are not: genuine NIRCam captions use
//                    them in passing.
//
//   NON_PHOTO_TEXT   Article prose, which describes the science rather than the
//                    picture. Only the phrases that admit no other reading.
//
// The apostrophe class covers both the plain and the typographic one: ESA and
// NASA write "artist’s concept" with U+2019.
var NON_PHOTO_TITLE = /artist['’]?s?[\s-]*(concept|impression|rendering|illustration|view)|\b(illustration|illustrated|artwork|infographic|diagram|schematic|light ?curve|animation|simulation|annotated|compass|collage|side-?by-?side|compar(ison|ed)|contour|poster|timeline|screenshot|stamps?|visuali[sz]ation)\b|\bspectr(um|a|oscopy)\b/i;
var NON_PHOTO_MEDIUM = /artist['’]?s?[\s-]*(concept|impression|illustration|rendering|view)|\b(illustration|illustrated|artwork|infographic|schematic|screenshot|photo ?illustration)\b/i;
var NON_PHOTO_TEXT = /artist['’]?s?[\s-]*(concept|impression|illustration|rendering)/i;

// The Webb release stream is not only sky: it also carries the observatory's
// public life — hardware on show at a museum, an award, a stamp issue. Those
// are photographs, so the vocabularies above pass them, but nobody wants one
// as a wallpaper. Matched against titles only: "mirror", "panel" and "tour"
// belong to a caption about a real nebula as readily as to a press event.
var NON_SKY_TITLE = /\b(hall of fame|award|ceremony|exhibit(ion)?|museum|smithsonian|hangar|clean ?room|pathfinder|mock-?up|logo|postage)\b/i;

/// Folds the separators the sources use inside filenames into spaces, so that
/// "Wasp-96_b_transmission_spectrum" reads as words. Without this the \b in
/// the patterns above never fires: an underscore is a word character.
function words(text) {
    return String(text || "").replace(/[_+.\/]+/g, " ");
}

/// True when the entry looks like an actual photograph rather than a diagram,
/// a spectrum or an artist's rendering.
function isPhotograph(entry) {
    const title = words(entry.title);
    return !NON_PHOTO_TITLE.test(title)
        && !NON_SKY_TITLE.test(title)
        && !NON_PHOTO_MEDIUM.test(words(entry.mediaText))
        && !NON_PHOTO_TEXT.test(words(entry.description));
}

// A joint release files every observatory's picture together: the Hubble frame
// of the Cat's Head Nebula sits in the Webb stream next to the NIRCam and MIRI
// ones, under the same release. A picture that names another telescope and
// not Webb is that telescope's.
var WEBB = /\b(webb|jwst|nircam|miri|nirspec|niriss)\b/i;
var OTHER_TELESCOPE = /\b(hubble|hst|wfc3|wfpc2|acs|chandra|spitzer)\b/i;

function isWebb(entry) {
    const text = words(entry.title) + " | " + words(entry.instrument);
    return WEBB.test(text) || !OTHER_TELESCOPE.test(text);
}

/* ------------------------------------------------------------------ utils */

function stripFileUrl(url) {
    return decodeURIComponent(String(url).replace(/^file:\/\//, ""));
}

function httpGet(url, headers, onDone) {
    const xhr = new XMLHttpRequest();
    xhr.onreadystatechange = function () {
        if (xhr.readyState !== XMLHttpRequest.DONE) {
            return;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
            onDone(null, xhr.responseText);
        } else {
            onDone("HTTP " + xhr.status + " for " + url, null);
        }
    };
    try {
        xhr.open("GET", url);
        xhr.setRequestHeader("User-Agent", UA);
        for (const k in (headers || {})) {
            xhr.setRequestHeader(k, headers[k]);
        }
        xhr.send();
    } catch (e) {
        onDone(String(e), null);
    }
}

// The named entities the sources actually use; science.nasa.gov writes its
// captions with &rsquo; and friends rather than numeric references.
var NAMED_ENTITIES = {
    quot: '"', apos: "'", nbsp: " ", lt: "<", gt: ">",
    lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
    ndash: "–", mdash: "—", hellip: "…", deg: "°", times: "×", micro: "µ"
};

function decodeEntities(s) {
    return String(s)
        .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(parseInt(d, 10)); })
        .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
        .replace(/&([a-z]+);/gi, function (whole, name) {
            return NAMED_ENTITIES.hasOwnProperty(name) ? NAMED_ENTITIES[name] : whole;
        })
        .replace(/&amp;/g, "&");
}

/// How much of a caption an entry carries for display.
var DESCRIPTION_LENGTH = 400;

function stripHtml(s, maxLength) {
    const out = decodeEntities(String(s || "").replace(/<[^>]*>/g, " "))
        .replace(/\s+/g, " ").trim();
    return maxLength ? truncate(out, maxLength) : out;
}

/// Cuts on a word boundary, so a caption kept in full for filtering can still
/// be shown short.
function truncate(text, maxLength) {
    const out = String(text || "");
    if (out.length <= maxLength) {
        return out;
    }
    return out.substring(0, maxLength).replace(/\s+\S*$/, "") + "…";
}

function rssItems(text) {
    const out = [];
    const re = /<item[\s>][\s\S]*?<\/item>/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
        out.push(m[0]);
    }
    return out;
}

function tagText(block, name) {
    const m = block.match(new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/" + name + ">", "i"));
    if (!m) {
        return "";
    }
    return decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim();
}

function tagAttr(block, name, attribute) {
    const m = block.match(new RegExp("<" + name + "\\s[^>]*" + attribute + "=[\"']([^\"']+)[\"']", "i"));
    return m ? decodeEntities(m[1]) : "";
}

function parseDate(s) {
    const t = Date.parse(String(s || ""));
    return isNaN(t) ? 0 : t;
}

function httpsify(url) {
    return String(url).replace(/^http:/, "https:");
}

/**
 * True when an image this size is drawn without being enlarged. Filling the
 * screen (cropped or stretched) takes both the width and the height of the
 * screen; fitting inside it takes either. An unknown height passes on the width
 * alone — the download is measured once it lands.
 *
 * `cfg.targetWidth`/`targetHeight` are the screen in physical pixels and
 * `cfg.fillsScreen` says which of the two rules the fill mode calls for.
 */
function largeEnough(width, height, cfg) {
    const wide = width >= (cfg.targetWidth || 0);
    if (!(height > 0) || !cfg.targetHeight) {
        return wide;
    }
    const tall = height >= cfg.targetHeight;
    return cfg.fillsScreen ? (wide && tall) : (wide || tall);
}

/// The narrowest rendition of an image of this aspect (height / width) that
/// is large enough for the screen.
function widthNeeded(aspect, cfg) {
    const width = cfg.targetWidth || 0;
    if (!(aspect > 0) || !cfg.targetHeight) {
        return width;
    }
    const forHeight = Math.ceil(cfg.targetHeight / aspect);
    return cfg.fillsScreen ? Math.max(width, forHeight) : Math.min(width, forHeight);
}

/// Drops the variants too small for the screen, unless that floor is off.
function largeEnoughOnly(variants, cfg) {
    if (!cfg.skipLowResolution) {
        return variants.slice();
    }
    return variants.filter(function (v) { return largeEnough(v.width, v.height, cfg); });
}

/**
 * Orders a provider's variants — handed in biggest first — the way the probe
 * should walk them, and drops the ones too small for the screen.
 *
 * The default is the caller's order: the biggest variant the budget allows,
 * which is also what "Save a Copy to Pictures" then hands you. With
 * `cfg.matchScreen` the order starts instead at the smallest variant that is
 * still large enough — the wallpaper is drawn at screen resolution either way
 * (the Image's sourceSize decodes no more than that), so this trades nothing
 * visible for a fraction of the bytes and the decode time.
 */
function chooseVariants(variants, cfg) {
    const usable = largeEnoughOnly(variants, cfg);
    if (!cfg.matchScreen || usable.length < 2) {
        return usable;
    }
    const enough = function (v) { return largeEnough(v.width, v.height, cfg); };
    const covering = usable.filter(enough)
                           .sort(function (a, b) { return a.width - b.width; });
    // Nothing large enough: fall back to the biggest there is, which is the
    // order they came in.
    const short = usable.filter(function (v) { return !enough(v); });
    return covering.concat(short);
}

/* ------------------------------------------------------------------ ESA/Webb */

function esa(cfg, done) {
    httpGet(ESA_FEED, null, function (err, text) {
        if (err) {
            done([], err);
            return;
        }
        const list = [];
        rssItems(text).forEach(function (item) {
            const enclosure = tagAttr(item, "enclosure", "url");
            if (!enclosure || !/\/archives\/images\/[^\/]+\//.test(enclosure)) {
                return;
            }
            const link = tagText(item, "link") || tagText(item, "guid");
            const slugMatch = link.match(/\/images\/([^\/]+)\/?$/);
            const slug = slugMatch ? slugMatch[1]
                                   : enclosure.replace(/^.*\//, "").replace(/\.[a-z]+$/i, "");

            // Not reordered for matchScreen: a wallpaper crop is only as sharp
            // as the original it was cut from, and that size is unknown until
            // "large" has been fetched. Walking biggest first, a crop is reached
            // only once "large" has blown the budget — which means the
            // original is huge and the crop a true reduction of it.
            const candidates = largeEnoughOnly(ESA_VARIANTS, cfg).map(function (variant) {
                return enclosure.replace(/\/archives\/images\/[^\/]+\//, "/archives/images/" + variant.name + "/");
            });
            if (candidates.length === 0) {
                return;
            }

            const caption = stripHtml(tagText(item, "description"));
            list.push({
                id: "esa:" + slug,
                source: "esa",
                sourceName: "ESA/Webb",
                title: stripHtml(tagText(item, "title")),
                description: truncate(caption, DESCRIPTION_LENGTH),
                mediaText: caption,
                credit: "ESA/Webb, NASA & CSA",
                infoUrl: link,
                date: parseDate(tagText(item, "pubDate")),
                candidates: candidates
            });
        });
        done(list, null);
    });
}

/* ------------------------------------------------------ NASA Science (STScI) */

// The pictures sit behind an on-the-fly rendition service that answers neither
// Content-Length nor range requests, so the size of a variant cannot be probed:
// it is estimated from the rendition's pixel count instead, and main.qml
// re-checks the real size once the file has landed.
function nasascience(cfg, done) {
    let url = NASA_SCIENCE_API
        + "?science-org=" + NASA_SCIENCE_IMAGES
        + "&per_page=100&orderby=date&order=desc"
        + "&_fields=" + encodeURIComponent("id,slug,date_gmt,link,title,excerpt,"
                                           + "acf.downloads,acf.data_instrument,acf.credits");
    if (cfg.photographsOnly) {
        url += "&science-org_exclude=" + NASA_SCIENCE_NOT_PHOTOS.join(",");
    }

    httpGet(url, null, function (err, text) {
        if (err) {
            done([], err);
            return;
        }
        let items;
        try {
            items = JSON.parse(text);
        } catch (e) {
            done([], "science.nasa.gov: malformed JSON");
            return;
        }
        if (!Array.isArray(items)) {
            done([], "science.nasa.gov: unexpected payload");
            return;
        }

        const budget = cfg.maxBytes || (25 * 1024 * 1024);
        const list = [];
        items.forEach(function (item) {
            const acf = item.acf || {};
            const master = nasaScienceMaster(acf.downloads);
            if (!master) {
                return;
            }
            const candidates = nasaScienceCandidates(master, budget, cfg);
            if (candidates.length === 0) {
                return;
            }
            list.push({
                id: "nasascience:" + (item.slug || item.id),
                source: "nasascience",
                sourceName: "NASA Science — Webb",
                title: stripHtml((item.title || {}).rendered),
                description: stripHtml((item.excerpt || {}).rendered, DESCRIPTION_LENGTH),
                credit: stripHtml(acf.credits) || "NASA, ESA, CSA, STScI",
                infoUrl: item.link,
                date: parseDate(item.date_gmt ? item.date_gmt + "Z" : item.date),
                candidates: candidates,
                instrument: stripHtml(acf.data_instrument)
            });
        });
        done(list, null);
    });
}

/// The asset's own file. Every other download listed beside it is a rendition
/// of it, filed under jcr:content/renditions/.
function nasaScienceMaster(downloads) {
    return (Array.isArray(downloads) ? downloads : []).filter(function (d) {
        return d && d.url && d.width > 0 && d.height > 0 && !/\/jcr:content\//.test(d.url);
    })[0] || null;
}

function nasaScienceCandidates(master, budget, cfg) {
    // The rendition service serves the same path, and turns the TIFF masters
    // into JPEG on the way.
    const base = String(master.url).replace("/content/dam/", "/dynamicimage/assets/");
    const nativeWidth = master.width;
    const aspect = master.height / master.width;
    // PNG renditions run about 1.6 bytes per pixel, JPEG ones far less.
    const bytesPerPixel = /\.png$/i.test(base) ? 1.6 : 0.3;

    // Native resolution first, then the standard renditions below it, plus the
    // exact width this screen needs: the service renders any width, so a
    // 3440-wide or a 5K screen gets its own size rather than the next one up.
    const widths = [nativeWidth].concat(NASA_SCIENCE_WIDTHS, [widthNeeded(aspect, cfg)])
        .filter(function (w, index, all) {
            return w > 0 && w <= nativeWidth && all.indexOf(w) === index;
        })
        .sort(function (a, b) { return b - a; });
    const variants = largeEnoughOnly(widths.map(function (w) {
        const height = Math.round(w * aspect);
        return { width: w, height: height, bytes: w * height * bytesPerPixel };
    }), cfg);
    if (variants.length === 0) {
        return []; // the release itself is smaller than the screen
    }
    const affordable = variants.filter(function (v) { return v.bytes <= budget; });
    const chosen = affordable.length > 0 ? affordable : [variants[variants.length - 1]];

    return chooseVariants(chosen, cfg).map(function (v) {
        return base + "?w=" + v.width + "&fit=clip";
    });
}

/* ------------------------------------------------------------------ jwstapi.com */

function jwstapi(cfg, done) {
    const key = String(cfg.jwstApiKey || "").trim();
    if (!key) {
        done([], "jwstapi: no API key configured");
        return;
    }
    httpGet(JWST_API + "?perPage=50&page=1", { "X-API-KEY": key }, function (err, text) {
        if (err) {
            done([], err);
            return;
        }
        let payload;
        try {
            payload = JSON.parse(text);
        } catch (e) {
            done([], "jwstapi: malformed JSON");
            return;
        }
        const list = [];
        (payload.body || []).forEach(function (item) {
            if (!item.location) {
                return;
            }
            const details = item.details || {};
            const label = details.description || details.mission || item.observation_id || item.id;
            list.push({
                id: "jwstapi:" + (item.id || item.observation_id || item.location),
                source: "jwstapi",
                sourceName: "jwstapi.com (MAST)",
                title: stripHtml(label),
                description: stripHtml(details.suffix ? ("Suffix " + details.suffix) : "", DESCRIPTION_LENGTH),
                credit: "NASA/STScI — MAST",
                infoUrl: item.location,
                date: parseDate(details.date || item.date),
                candidates: [httpsify(item.location)]
            });
        });
        done(list, null);
    });
}

/* ------------------------------------------------------------------ orchestration */

// In order of preference: when two sources carry the same picture, the one
// listed first is kept. science.nasa.gov states every picture's size and
// renders it at whatever width the screen needs; ESA offers the original or a
// handful of fixed crops, and its size is known only once it is downloaded.
var PROVIDERS = {
    nasascience: nasascience,
    esa: esa,
    jwstapi: jwstapi
};

/**
 * Queries every enabled provider in parallel and calls
 * done(entries, errors) once all of them have answered.
 * `entries` is deduplicated and sorted newest first.
 */
function fetchAll(cfg, done) {
    const wanted = cfg.enabledSources || [];
    const enabled = Object.keys(PROVIDERS).filter(function (name) {
        return wanted.indexOf(name) !== -1;
    });
    if (enabled.length === 0) {
        done([], ["no source enabled"]);
        return;
    }

    let pending = enabled.length;
    const results = {};
    const errors = [];

    enabled.forEach(function (name) {
        PROVIDERS[name](cfg, function (list, err) {
            if (err) {
                errors.push(name + ": " + err);
            }
            results[name] = list || [];
            if (--pending > 0) {
                return;
            }
            // Merged in preference order, not in the order the answers came
            // back, so that dedupe() keeps the same copy every time.
            let entries = [];
            enabled.forEach(function (n) { entries = entries.concat(results[n]); });
            entries = entries.filter(isWebb);
            if (cfg.photographsOnly) {
                entries = entries.filter(isPhotograph);
            }
            entries = dedupe(entries);
            // The filtering text has done its job; main.qml holds this pool
            // for a quarter of an hour and only needs what the caption shows.
            entries.forEach(function (entry) {
                delete entry.mediaText;
                delete entry.instrument;
            });
            done(entries, errors);
        });
    });
}

/**
 * Drops repeats, keeping the first copy. A repeat is the same id, or the same
 * title on the same day: a joint release goes out from ESA and NASA at once
 * under one title ("Cat's Head Nebula (Webb NIRCam image)"), and ESA files
 * several cuts of one picture under one title too.
 */
function dedupe(entries) {
    const seen = {};
    const out = [];
    entries.forEach(function (e) {
        if (!e || !e.id || !e.candidates || e.candidates.length === 0) {
            return;
        }
        const keys = [e.id, sameTitleKey(e)];
        if (keys.some(function (k) { return seen[k]; })) {
            return;
        }
        keys.forEach(function (k) { seen[k] = true; });
        out.push(e);
    });
    out.sort(function (a, b) { return b.date - a.date; });
    return out;
}

function sameTitleKey(entry) {
    const title = String(entry.title || "").toLowerCase()
        .replace(/['’]/g, "")
        .replace(/\bimages?\b/g, " ") // "(Webb MIRI)" and "(Webb MIRI Image)" alike
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    const day = new Date(entry.date || 0).toISOString().slice(0, 10);
    return "title:" + title + "|" + day;
}

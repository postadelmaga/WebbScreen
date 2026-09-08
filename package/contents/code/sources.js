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
 *   }
 *
 * Nothing here touches the filesystem: main.qml probes the candidates and
 * picks the largest one that fits the configured download budget.
 */

var UA = "Mozilla/5.0 (X11; Linux x86_64) WebbScreen/1.0 (KDE Plasma wallpaper)";

var FLICKR_NSID = "50785054@N03"; // NASA's James Webb Space Telescope
// The size suffixes reachable from the public feed, with their fixed long-edge
// widths, so a variant can be ruled out as too small before it is ever
// requested. The list stops at "_b" (1024 px) because that is where the feed
// stops: it hands out the small "_m" URL, the suffixes up to "_b" resolve
// against that same secret, and every larger one — "_h", "_k", "_3k", "_4k" … —
// is served under a different secret and answers 410 Gone for every photo in
// the stream. Those sizes exist only with an API key; see FLICKR_EXTRAS.
var FLICKR_SIZES = [
    { suffix: "_b", width: 1024 },
    { suffix: "_c", width: 800 },
    { suffix: "_z", width: 640 }
];
var FLICKR_EXTRAS = [
    { key: "url_o", width: Infinity },
    { key: "url_6k", width: 6144 },
    { key: "url_5k", width: 5120 },
    { key: "url_4k", width: 4096 },
    { key: "url_3k", width: 3072 },
    { key: "url_k", width: 2048 },
    { key: "url_h", width: 1600 },
    { key: "url_b", width: 1024 }
];

var ESA_FEED = "https://esawebb.org/images/feed/";
var ESA_VARIANTS = [
    { name: "large", width: Infinity }, // the unscaled release JPEG
    { name: "wallpaper5", width: 2048 },
    { name: "wallpaper4", width: 1920 },
    { name: "screen", width: 1280 }
];

var NASA_SEARCH = "https://images-api.nasa.gov/search";
var NASA_VARIANTS = ["~orig", "~large", "~medium"];
// Captions that read like an astronomical subject rather than a press photo.
var NASA_SUBJECT = /nebula|galax|star cluster|starburst|exoplanet|protostar|supernova|deep field|cosmic cliff|jupiter|saturn|neptune|uranus|asteroid|comet|quasar|black hole|transmission spectrum|carina|orion|pillars of creation|stephan|smacs|wasp-|dark matter|infrared (image|view)/i;
var NASA_EVENT = /town hall|panel|ceremony|award|briefing|interview|portrait|administrator|festival|screening|premiere|employee|visit|tour|clean ?room|technician|engineer|assembl|mirror|sunshield|installation|rollout|conference|revealed|artist event|shake, rattle/i;

// webbtelescope.org (STScI) now redirects to science.nasa.gov, whose WordPress
// REST API carries the Webb release stream under one category.
var NASA_SCIENCE_API = "https://science.nasa.gov/wp-json/wp/v2/posts";
var NASA_SCIENCE_CATEGORY = 2881; // "James Webb Space Telescope (JWST)"
var NASA_SCIENCE_WIDTHS = [3840, 2560, 1920, 1440];

var JWST_API = "https://api.jwstapi.com/all/type/jpg";

// Not every release is a photograph. Titles follow a tight convention across
// the sources — "(artist's concept)", "transmission spectrum", "(annotated
// NIRCam image)" — so they can be matched broadly. Captions cannot: a genuine
// NIRCam image happily mentions "spectrum" in passing, so only the phrases that
// admit no other reading are matched there.
// The apostrophe class covers both the plain and the typographic one: ESA and
// NASA write "artist’s concept" with U+2019.
var NON_PHOTO_TITLE = /artist['’]?s?[\s-]*(concept|impression|rendering|illustration|view)|\b(illustration|illustrated|artwork|infographic|diagram|schematic|light ?curve|animation|simulation|annotated|compass image|poster|timeline|data visuali[sz]ation)\b|\bspectr(um|a|oscopy)\b/i;
var NON_PHOTO_TEXT = /artist['’]?s?[\s-]*(concept|impression|illustration|rendering)/i;

/// True when the entry looks like an actual photograph rather than a diagram,
/// a spectrum or an artist's rendering.
function isPhotograph(entry) {
    return !NON_PHOTO_TITLE.test(entry.title || "")
        && !NON_PHOTO_TEXT.test(entry.description || "");
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

function decodeEntities(s) {
    return String(s)
        .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(parseInt(d, 10)); })
        .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
}

function stripHtml(s, maxLength) {
    let out = decodeEntities(String(s || "").replace(/<[^>]*>/g, " "));
    out = out.replace(/\s+/g, " ").trim();
    if (maxLength && out.length > maxLength) {
        out = out.substring(0, maxLength).replace(/\s+\S*$/, "") + "…";
    }
    return out;
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

/// Keeps the variants at least `minWidth` wide, or all of them when unfiltered.
function atLeastAsWideAs(variants, minWidth) {
    if (!minWidth) {
        return variants;
    }
    return variants.filter(function (v) { return v.width >= minWidth; });
}

/// Flickr captions are peppered with :emoji_shortcodes:.
function stripShortcodes(text) {
    return String(text).replace(/:[a-z][a-z0-9_+-]{1,30}:/g, " ").replace(/\s+/g, " ").trim();
}

// Feed authors look like: nobody@flickr.com ("James Webb Space Telescope")
function flickrAuthorName(author) {
    const m = String(author || "").match(/\("([^"]+)"\)/);
    return m ? m[1] : "";
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

            const candidates = atLeastAsWideAs(ESA_VARIANTS, cfg.minWidth).map(function (variant) {
                return enclosure.replace(/\/archives\/images\/[^\/]+\//, "/archives/images/" + variant.name + "/");
            });
            if (candidates.length === 0) {
                return;
            }

            list.push({
                id: "esa:" + slug,
                source: "esa",
                sourceName: "ESA/Webb",
                title: stripHtml(tagText(item, "title")),
                description: stripHtml(tagText(item, "description"), 400),
                credit: "ESA/Webb, NASA & CSA",
                infoUrl: link,
                date: parseDate(tagText(item, "pubDate")),
                candidates: candidates
            });
        });
        done(list, null);
    });
}

/* ------------------------------------------------------------------ NASA */

// images.nasa.gov indexes the whole agency archive, so a plain "James Webb
// Space Telescope" query returns mostly clean-room and press-event photography.
// Two complementary queries are merged instead:
//   * everything filed under the STScI centres — the curated science releases;
//   * a broad query, kept only when the caption reads like an astronomical
//     subject and not like an event photo.
function nasa(cfg, done) {
    const curated = NASA_SEARCH + "?media_type=image&page_size=100&center=STScI";
    const broad = NASA_SEARCH
        + "?q=" + encodeURIComponent("James Webb Space Telescope")
        + "&media_type=image&page_size=100";

    let pending = 2;
    let merged = [];
    const errors = [];

    function collect(err, list) {
        if (err) {
            errors.push(err);
        }
        merged = merged.concat(list);
        if (--pending === 0) {
            done(merged, errors.length === 2 ? errors.join("; ") : null);
        }
    }

    httpGet(curated, null, function (err, text) {
        collect(err, err ? [] : nasaEntries(text, true));
    });
    httpGet(broad, null, function (err, text) {
        collect(err, err ? [] : nasaEntries(text, false));
    });
}

function nasaEntries(text, curated) {
    let payload;
    try {
        payload = JSON.parse(text);
    } catch (e) {
        return [];
    }
    const items = (payload.collection && payload.collection.items) || [];
    const list = [];

    items.forEach(function (item) {
        const data = (item.data || [])[0];
        if (!data || !data.nasa_id) {
            return;
        }
        const haystack = [data.title, data.description, data.description_508,
                          (data.keywords || []).join(" ")].join(" ");

        if (curated) {
            // The STScI centres also host Hubble releases.
            if (!/webb|jwst|nircam|miri|nirspec/i.test(haystack + " " + data.center)) {
                return;
            }
        } else {
            if (/^(HQ|JSC|KSC|MSFC|LaRC)$/.test(data.center || "")) {
                return;
            }
            if (NASA_EVENT.test(haystack) || !NASA_SUBJECT.test(haystack)) {
                return;
            }
        }

        const preview = (item.links || []).filter(function (l) {
            return l.render === "image" && l.href;
        }).map(function (l) { return httpsify(l.href); })[0];
        if (!preview) {
            return;
        }

        // https://…/PIA11195~thumb.jpg  ->  https://…/PIA11195~orig.jpg
        const parts = preview.match(/^(.*)~[a-z0-9]+(\.[a-z]+)$/i);
        let candidates;
        if (parts) {
            candidates = NASA_VARIANTS.map(function (v) { return parts[1] + v + parts[2]; });
            if (parts[2].toLowerCase() !== ".png") {
                candidates.splice(1, 0, parts[1] + "~orig.png");
            }
        } else {
            candidates = [preview];
        }

        list.push({
            id: "nasa:" + data.nasa_id,
            source: "nasa",
            sourceName: "NASA Image Library",
            title: stripHtml(data.title),
            description: stripHtml(data.description || data.description_508, 400),
            credit: data.secondary_creator || ("NASA" + (data.center ? "/" + data.center : "")),
            infoUrl: "https://images.nasa.gov/details/" + encodeURIComponent(data.nasa_id),
            date: parseDate(data.date_created),
            candidates: candidates
        });
    });
    return list;
}

/* ------------------------------------------------------ NASA Science (STScI) */

// The press images sit behind an on-the-fly rendition service that answers
// neither Content-Length nor range requests, so the size of a variant cannot be
// probed — it is estimated from the rendition's pixel count instead, and
// main.qml re-checks the real size once the file has landed.
function nasascience(cfg, done) {
    const url = NASA_SCIENCE_API
        + "?categories=" + NASA_SCIENCE_CATEGORY
        + "&per_page=100&orderby=date&order=desc"
        + "&_fields=" + encodeURIComponent("id,slug,date_gmt,link,title,excerpt,featured_image_url");

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
            const image = item.featured_image_url || "";
            const title = stripHtml((item.title || {}).rendered);
            if (!image) {
                return;
            }
            // The Webb category also tags the odd Hubble or multi-mission release.
            if (!/\/missions\/webb\//.test(image) && !/webb/i.test(title)) {
                return;
            }
            const candidates = nasaScienceCandidates(image, budget, cfg.minWidth);
            if (candidates.length === 0) {
                return;
            }
            list.push({
                id: "nasascience:" + (item.slug || item.id),
                source: "nasascience",
                sourceName: "NASA Science — Webb",
                title: title,
                description: stripHtml((item.excerpt || {}).rendered, 400),
                credit: "NASA, ESA, CSA, STScI",
                infoUrl: item.link,
                date: parseDate(item.date_gmt ? item.date_gmt + "Z" : item.date),
                candidates: candidates
            });
        });
        done(list, null);
    });
}

function nasaScienceCandidates(imageUrl, budget, minWidth) {
    const split = imageUrl.split("?");
    const base = split[0];
    if (split.length < 2) {
        return [imageUrl]; // a plain upload, not served by the rendition service
    }
    const widthMatch = split[1].match(/(?:^|&)w=(\d+)/);
    const heightMatch = split[1].match(/(?:^|&)h=(\d+)/);
    if (!widthMatch || !heightMatch) {
        return [imageUrl];
    }
    const nativeWidth = parseInt(widthMatch[1], 10);
    const aspect = parseInt(heightMatch[1], 10) / nativeWidth;
    // PNG renditions run about 1.6 bytes per pixel, JPEG ones far less.
    const bytesPerPixel = /\.png$/i.test(base) ? 1.6 : 0.3;

    // Native resolution first, then the standard renditions below it.
    let widths = [nativeWidth].concat(NASA_SCIENCE_WIDTHS.filter(function (w) {
        return w < nativeWidth;
    }));
    if (minWidth) {
        widths = widths.filter(function (w) { return w >= minWidth; });
        if (widths.length === 0) {
            return []; // the release itself is smaller than the screen
        }
    }
    const affordable = widths.filter(function (w) {
        return w * (w * aspect) * bytesPerPixel <= budget;
    });
    const chosen = affordable.length > 0 ? affordable : [widths[widths.length - 1]];

    return chosen.map(function (w) { return base + "?w=" + w + "&fit=clip"; });
}

/* ------------------------------------------------------------------ Flickr */

function flickr(cfg, done) {
    const key = String(cfg.flickrApiKey || "").trim();
    if (key) {
        flickrWithKey(key, cfg.minWidth, done);
    } else {
        flickrPublicFeed(cfg.minWidth, done);
    }
}

// Keyless: the public photostream feed, which tops out at 1024 px — see
// FLICKR_SIZES. Offering the larger suffixes anyway, as this used to, fills the
// pool with entries whose every variant 410s; because they are the newest
// images they sit at the head of the queue, where they burn through the attempt
// budget in main.qml before a usable picture is ever reached.
function flickrPublicFeed(minWidth, done) {
    const url = "https://api.flickr.com/services/feeds/photos_public.gne?id="
        + FLICKR_NSID + "&format=json&nojsoncallback=1";

    httpGet(url, null, function (err, text) {
        if (err) {
            done([], err);
            return;
        }
        let payload;
        try {
            payload = JSON.parse(text);
        } catch (e) {
            done([], "Flickr: malformed JSON");
            return;
        }
        const list = [];
        (payload.items || []).forEach(function (item) {
            const small = item.media && item.media.m;
            if (!small) {
                return;
            }
            const idMatch = String(item.link).match(/\/(\d+)\/?$/);
            const stem = small.replace(/_[a-z0-9]+\.jpg$/i, "");
            const sizes = atLeastAsWideAs(FLICKR_SIZES, minWidth);
            if (sizes.length === 0) {
                return;
            }
            list.push({
                id: "flickr:" + (idMatch ? idMatch[1] : stem),
                source: "flickr",
                sourceName: "Flickr — NASA Webb",
                title: stripHtml(item.title),
                description: stripShortcodes(stripHtml(String(item.description || "").replace(/^[\s\S]*?posted a photo:/i, ""), 400)),
                credit: flickrAuthorName(item.author) || "NASA/ESA/CSA — James Webb Space Telescope",
                infoUrl: item.link,
                date: parseDate(item.date_taken || item.published),
                candidates: sizes.map(function (size) { return stem + size.suffix + ".jpg"; })
            });
        });
        done(list, null);
    });
}

// With a (free) API key we get the real URLs, originals included, in one call.
function flickrWithKey(key, minWidth, done) {
    const extras = "description,date_upload,date_taken,owner_name,url_o,url_6k,url_5k,url_4k,url_3k,url_k,url_h,url_b";
    const url = "https://api.flickr.com/services/rest/"
        + "?method=flickr.people.getPublicPhotos&api_key=" + encodeURIComponent(key)
        + "&user_id=" + FLICKR_NSID + "&per_page=100&page=1"
        + "&extras=" + encodeURIComponent(extras)
        + "&format=json&nojsoncallback=1";

    httpGet(url, null, function (err, text) {
        if (err) {
            flickrPublicFeed(minWidth, done); // key rejected or offline: degrade gracefully
            return;
        }
        let payload;
        try {
            payload = JSON.parse(text);
        } catch (e) {
            flickrPublicFeed(minWidth, done);
            return;
        }
        if (payload.stat !== "ok" || !payload.photos) {
            flickrPublicFeed(minWidth, done);
            return;
        }
        const order = atLeastAsWideAs(FLICKR_EXTRAS, minWidth);
        const list = [];
        (payload.photos.photo || []).forEach(function (photo) {
            const candidates = order.map(function (size) { return photo[size.key]; })
                                    .filter(function (u) { return !!u; })
                                    .map(httpsify);
            if (candidates.length === 0) {
                return;
            }
            const taken = photo.datetaken || "";
            const uploaded = photo.dateupload ? parseInt(photo.dateupload, 10) * 1000 : 0;
            list.push({
                id: "flickr:" + photo.id,
                source: "flickr",
                sourceName: "Flickr — NASA Webb",
                title: stripHtml(photo.title),
                description: stripShortcodes(stripHtml(photo.description && photo.description._content, 400)),
                credit: photo.ownername || "NASA/ESA/CSA — James Webb Space Telescope",
                infoUrl: "https://www.flickr.com/photos/" + FLICKR_NSID + "/" + photo.id + "/",
                date: parseDate(taken) || uploaded,
                candidates: candidates
            });
        });
        done(list, null);
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
                description: stripHtml(details.suffix ? ("Suffix " + details.suffix) : "", 400),
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

var PROVIDERS = {
    nasa: nasa,
    nasascience: nasascience,
    esa: esa,
    flickr: flickr,
    jwstapi: jwstapi
};

/**
 * Queries every enabled provider in parallel and calls
 * done(entries, errors) once all of them have answered.
 * `entries` is deduplicated and sorted newest first.
 */
function fetchAll(cfg, done) {
    const enabled = (cfg.enabledSources || []).filter(function (name) {
        return !!PROVIDERS[name];
    });
    if (enabled.length === 0) {
        done([], ["no source enabled"]);
        return;
    }

    let pending = enabled.length;
    let merged = [];
    const errors = [];

    enabled.forEach(function (name) {
        PROVIDERS[name](cfg, function (list, err) {
            if (err) {
                errors.push(name + ": " + err);
            }
            merged = merged.concat(list || []);
            if (--pending === 0) {
                let entries = dedupe(merged);
                if (cfg.photographsOnly) {
                    entries = entries.filter(isPhotograph);
                }
                done(entries, errors);
            }
        });
    });
}

function dedupe(entries) {
    const seen = {};
    const out = [];
    entries.forEach(function (e) {
        if (!e || !e.id || seen[e.id] || !e.candidates || e.candidates.length === 0) {
            return;
        }
        seen[e.id] = true;
        out.push(e);
    });
    out.sort(function (a, b) { return b.date - a.date; });
    return out;
}

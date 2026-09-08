/*
 * WebbScreen — James Webb Space Telescope wallpapers for KDE Plasma 6.
 * SPDX-FileCopyrightText: 2026 postadelmaga
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import QtCore
import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Effects
import QtQuick.Window

import org.kde.kirigami as Kirigami
import org.kde.plasma.core as PlasmaCore
import org.kde.plasma.plasmoid

import "../code/commands.js" as Commands
import "../code/sources.js" as Sources

WallpaperItem {
    id: root

    readonly property string domain: "plasma_wallpaper_org.kde.webbscreen"

    readonly property string cacheDir:
        Sources.stripFileUrl(StandardPaths.writableLocation(StandardPaths.GenericCacheLocation)) + "/webbscreen"
    readonly property string picturesDir:
        Sources.stripFileUrl(StandardPaths.writableLocation(StandardPaths.PicturesLocation)) + "/WebbScreen"

    readonly property int imageFillMode: root.configuration.FillMode
    readonly property url imageSource: {
        const path = root.configuration.CurrentImagePath;
        if (path.length === 0) {
            return "";
        }
        return /^[a-z]+:\/\//.test(path) ? path : "file://" + encodeURI(path);
    }

    /// True while a source query or a download is in flight.
    property bool busy: false
    /// Last error, surfaced in the config dialog and on the console.
    property string statusMessage: ""

    /// Everything the sources returned last time, newest first, never reordered.
    property var pool: []
    /// The pool ordered for the switch in progress.
    property var queue: []
    property int attempt: 0
    property double poolFetchedAt: 0

    /// How long a fetched pool may be reused before the sources are queried
    /// again. Short rotation intervals advance within this window, so testing
    /// at 5 seconds does not hammer the APIs.
    readonly property int poolTtlMs: 15 * 60 * 1000

    /* ------------------------------------------------------------ helpers */

    function sourceConfig() {
        const enabled = [];
        if (root.configuration.SourceNasaScience) {
            enabled.push("nasascience");
        }
        if (root.configuration.SourceNasa) {
            enabled.push("nasa");
        }
        if (root.configuration.SourceEsa) {
            enabled.push("esa");
        }
        if (root.configuration.SourceFlickr) {
            enabled.push("flickr");
        }
        if (root.configuration.SourceJwstApi) {
            enabled.push("jwstapi");
        }
        return {
            enabledSources: enabled,
            maxBytes: root.maxBytes(),
            minWidth: root.minWidth(),
            photographsOnly: root.configuration.PhotographsOnly,
            flickrApiKey: root.configuration.FlickrApiKey,
            jwstApiKey: root.configuration.JwstApiKey
        };
    }

    function maxBytes() {
        return Math.max(1, root.configuration.MaxDownloadMegabytes) * 1024 * 1024;
    }

    /// Variants narrower than the screen are not worth downloading; the floor is
    /// the widest screen this desktop spans, in physical pixels.
    function minWidth() {
        if (!root.configuration.SkipLowResolution) {
            return 0;
        }
        return Math.round(Math.max(root.width, Screen.width) * Screen.devicePixelRatio);
    }

    /// A sanity floor only: enough to reject error pages served with a 200.
    function minBytes() {
        return 20 * 1024;
    }

    function intervalElapsed() {
        const last = Date.parse(root.configuration.LastUpdateTime);
        if (isNaN(last)) {
            return true;
        }
        return (Date.now() - last) >= root.rotateIntervalMs();
    }

    function rotateIntervalMs() {
        return Math.max(5, root.configuration.UpdateIntervalSeconds) * 1000;
    }

    /// How many images back you can step. Each entry carries what the caption
    /// needs plus the variant URL, so a pruned image can be fetched again.
    readonly property int historyLimit: 15
    readonly property bool canGoBack: root.configuration.HistoryIndex > 0

    function historyList() {
        try {
            const parsed = JSON.parse(root.configuration.History || "[]");
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            return [];
        }
    }

    function recordHistory(entry, path, sourceUrl) {
        let list = root.historyList();
        const index = root.configuration.HistoryIndex;
        // Showing something new drops whatever was ahead of the cursor.
        if (index >= 0 && index < list.length - 1) {
            list = list.slice(0, index + 1);
        }
        if (list.length === 0 || list[list.length - 1].id !== entry.id) {
            list.push({
                id: entry.id,
                title: entry.title,
                description: entry.description,
                credit: entry.credit,
                sourceName: entry.sourceName,
                infoUrl: entry.infoUrl,
                path: path,
                url: sourceUrl
            });
        }
        if (list.length > root.historyLimit) {
            list = list.slice(list.length - root.historyLimit);
        }
        root.configuration.History = JSON.stringify(list);
        return list.length - 1;
    }

    function resetPool() {
        root.pool = [];
        root.poolFetchedAt = 0;
        root.rescheduleTimer();
    }

    function poolIsFresh() {
        return root.pool.length > 0 && (Date.now() - root.poolFetchedAt) < root.poolTtlMs;
    }

    function markSeen(id) {
        const seen = (root.configuration.SeenIds || []).filter(entryId => entryId !== id);
        seen.push(id);
        root.configuration.SeenIds = seen.slice(Math.max(0, seen.length - 300));
    }

    /* ------------------------------------------------------------ scheduling */

    /**
     * Two independent schedules: checkTimer polls the sources for new releases,
     * rotateTimer moves through the images already fetched.
     */
    function rescheduleTimer() {
        if (root.configuration.UpdateMode === 2) {
            checkTimer.stop();
            rotateTimer.stop();
            return;
        }
        checkTimer.interval = Math.max(5, root.configuration.CheckIntervalMinutes) * 60000;
        checkTimer.restart();
        root.restartRotation();
    }

    /**
     * Restarts only the rotation clock. Kept apart from rescheduleTimer() so
     * that switching an image never pushes back the source poll — otherwise a
     * short rotation interval would starve it completely.
     */
    function restartRotation() {
        if (root.configuration.UpdateMode !== 0) {
            rotateTimer.stop();
            return;
        }
        rotateTimer.interval = root.rotateIntervalMs();
        rotateTimer.restart();
    }

    /// Steps back through the images already shown.
    function previous() {
        if (root.busy || !root.canGoBack) {
            return;
        }
        root.showHistoryAt(root.configuration.HistoryIndex - 1, -1);
    }

    /**
     * Shows the history entry at `index`, refetching it when the cache no longer
     * holds it. `direction` says which way to keep looking if that fails.
     */
    function showHistoryAt(index, direction) {
        const list = root.historyList();
        const item = list[index];
        if (!item) {
            root.busy = false;
            return;
        }
        if (!shell.isAvailable()) {
            root.applyEntry(item, item.path, index);
            return;
        }
        root.busy = true;
        shell.run("[ -s " + shell.quote(item.path) + " ]", function (result) {
            if (result.code === 0) {
                root.applyEntry(item, item.path, index);
                return;
            }
            // Pruned from the cache: fetch that exact variant again.
            shell.run(Commands.downloadCommand(shell.quote, Sources.UA, root.cacheDir,
                                               item.url, item.path, root.maxBytes()),
                      function (download) {
                if (download.code === 0) {
                    root.applyEntry(item, item.path, index);
                    return;
                }
                const next = index + direction;
                if (next >= 0 && next < list.length) {
                    root.showHistoryAt(next, direction);
                } else {
                    root.busy = false;
                }
            });
        });
    }

    /**
     * Moves to the next image: forward through the history when the cursor is
     * behind, otherwise a new one, reusing the last fetched pool when it is
     * still fresh so the switch costs one download instead of a full round of
     * source queries.
     */
    function advance() {
        if (root.busy) {
            return;
        }
        const history = root.historyList();
        const index = root.configuration.HistoryIndex;
        if (index >= 0 && index < history.length - 1) {
            root.showHistoryAt(index + 1, 1);
            return;
        }
        if (root.configuration.CurrentId.length > 0) {
            root.markSeen(root.configuration.CurrentId);
        }
        if (!root.poolIsFresh()) {
            root.update(true);
            return;
        }
        root.busy = true;
        root.queue = root.orderPool(root.pool, false);
        root.attempt = 0;
        root.tryNextCandidate();
    }

    /**
     * Queries the enabled sources and, when a change is due, switches the
     * wallpaper. `force` bypasses the update policy (used by the context menu).
     */
    function update(force) {
        if (root.busy) {
            return;
        }
        if (!force && root.configuration.UpdateMode === 2) {
            return;
        }
        root.busy = true;
        Sources.fetchAll(root.sourceConfig(), function (entries, errors) {
            root.onEntriesFetched(entries, errors, force);
        });
    }

    function onEntriesFetched(entries, errors, force) {
        if (entries.length === 0) {
            root.busy = false;
            root.statusMessage = errors.length > 0 ? errors.join(" · ") : i18nd(root.domain, "No images found");
            console.warn("WebbScreen:", root.statusMessage);
            root.restartRotation();
            return;
        }
        root.statusMessage = "";
        root.pool = entries;
        root.poolFetchedAt = Date.now();

        const newestId = entries[0].id;
        const previousNewest = root.configuration.LastKnownNewestId;
        const hasNewRelease = previousNewest.length > 0 && newestId !== previousNewest;
        root.configuration.LastKnownNewestId = newestId;

        const switchToNew = hasNewRelease && root.configuration.SwitchOnNewImage;
        const due = force
            || root.configuration.CurrentImagePath.length === 0
            || switchToNew
            || (root.configuration.UpdateMode === 0 && root.intervalElapsed());

        if (!due) {
            root.busy = false;
            root.restartRotation();
            return;
        }

        root.queue = root.orderPool(entries, switchToNew);
        root.attempt = 0;
        root.tryNextCandidate();
    }

    function orderPool(entries, switchToNew) {
        if (switchToNew || root.configuration.Selection === 2) {
            return entries; // already newest first
        }
        const seen = root.configuration.SeenIds || [];
        let unseen = entries.filter(entry => seen.indexOf(entry.id) === -1);
        if (unseen.length === 0) {
            unseen = entries.slice();
        }
        if (root.configuration.Selection === 1) {
            for (let i = unseen.length - 1; i > 0; --i) {
                const j = Math.floor(Math.random() * (i + 1));
                const tmp = unseen[i];
                unseen[i] = unseen[j];
                unseen[j] = tmp;
            }
        }
        return unseen;
    }

    /* ------------------------------------------------------------ downloading */

    function tryNextCandidate() {
        // Generous, because a source can advertise entries whose variants all
        // turn out to be too small (Flickr without an API key, typically).
        if (root.attempt >= Math.min(8, root.queue.length)) {
            root.busy = false;
            root.statusMessage = i18nd(root.domain, "No usable image variant found");
            console.warn("WebbScreen:", root.statusMessage);
            root.restartRotation();
            return;
        }
        root.tryEntry(root.queue[root.attempt++], null);
    }

    /**
     * Picks a variant of `entry` and installs it. `candidates` narrows the
     * search after a variant turned out to be unusable; null means "all of them".
     */
    function tryEntry(entry, candidates) {
        const remaining = candidates || entry.candidates;
        if (remaining.length === 0) {
            root.markSeen(entry.id);
            root.tryNextCandidate();
            return;
        }

        if (!shell.isAvailable()) {
            // No executable data engine: stream the image straight from the web.
            root.applyImage(entry, remaining[remaining.length > 1 ? 1 : 0]);
            return;
        }

        shell.run(Commands.probeCommand(shell.quote, Sources.UA, remaining, root.maxBytes(), root.minBytes()), function (result) {
            if (result.code !== 0 || result.stdout.trim().length === 0) {
                root.markSeen(entry.id);
                root.tryNextCandidate();
                return;
            }
            const url = Commands.probeResultUrl(result.stdout);
            root.download(entry, url, remaining);
        });
    }

    function download(entry, url, candidates) {
        const destination = root.cacheDir + "/" + Commands.cacheFileName(entry.id, url);
        const command = Commands.downloadCommand(shell.quote, Sources.UA, root.cacheDir,
                                                 url, destination, root.maxBytes());

        shell.run(command, function (result) {
            if (result.code === 3) {
                // Only knowable after the fact for on-the-fly renditions: the
                // variant blew the budget, so retry with the smaller ones.
                root.tryEntry(entry, candidates.filter(candidate => candidate !== url));
                return;
            }
            if (result.code !== 0) {
                console.warn("WebbScreen: download failed for", url, result.stderr);
                root.markSeen(entry.id);
                root.tryNextCandidate();
                return;
            }
            root.applyImage(entry, destination, url);
            root.pruneCache(Commands.cacheFileName(entry.id, url));
        });
    }

    /// Installs a brand new image and appends it to the history.
    function applyImage(entry, pathOrUrl, sourceUrl) {
        root.markSeen(entry.id);
        const index = root.recordHistory(entry, pathOrUrl, sourceUrl || pathOrUrl);
        root.applyEntry(entry, pathOrUrl, index);
    }

    /// Puts an entry on screen. Shared by new images and history navigation, so
    /// it must not touch the history itself.
    function applyEntry(entry, pathOrUrl, historyIndex) {
        root.configuration.CurrentImagePath = pathOrUrl;
        root.configuration.CurrentId = entry.id;
        root.configuration.CurrentTitle = entry.title;
        root.configuration.CurrentDescription = entry.description;
        root.configuration.CurrentCredit = entry.credit;
        root.configuration.CurrentSourceName = entry.sourceName;
        root.configuration.CurrentInfoUrl = entry.infoUrl;
        root.configuration.HistoryIndex = historyIndex;
        root.configuration.LastUpdateTime = new Date().toISOString();
        root.busy = false;
        root.restartRotation();
    }

    function pruneCache(keepFileName) {
        const command = Commands.pruneCommand(shell.quote, root.cacheDir,
                                              Math.max(1, root.configuration.CachedImageCount),
                                              keepFileName);
        shell.run(command, null);
    }

    function saveCopy() {
        const path = root.configuration.CurrentImagePath;
        if (path.length === 0 || /^[a-z]+:\/\//.test(path)) {
            return;
        }
        const name = path.replace(/^.*\//, "");
        shell.run(Commands.saveCopyCommand(shell.quote, path, root.picturesDir, name),
                  function (result) {
                      if (result.code === 0) {
                          console.log("WebbScreen: saved copy to", root.picturesDir);
                      }
                  });
    }

    function nextImage() {
        root.advance();
    }

    /* ------------------------------------------------------------ actions */

    contextualActions: [
        PlasmaCore.Action {
            text: i18nd(root.domain, "Previous Webb Image")
            icon.name: "media-skip-backward-symbolic"
            enabled: !root.busy && root.canGoBack
            onTriggered: root.previous()
        },
        PlasmaCore.Action {
            text: i18nd(root.domain, "Next Webb Image")
            icon.name: "media-skip-forward-symbolic"
            enabled: !root.busy
            onTriggered: root.nextImage()
        },
        PlasmaCore.Action {
            text: root.configuration.CurrentTitle.length > 0
                ? i18ndc(root.domain, "@action:inmenu Placeholder is the title of the image", "About “%1”", root.configuration.CurrentTitle)
                : i18ndc(root.domain, "@action:inmenu", "About This Image")
            icon.name: "help-about-symbolic"
            visible: root.configuration.CurrentInfoUrl.length > 0
            onTriggered: Qt.openUrlExternally(root.configuration.CurrentInfoUrl)
        },
        PlasmaCore.Action {
            text: i18nd(root.domain, "Open Wallpaper Image")
            icon.name: "document-open"
            visible: root.imageSource.toString().length > 0
            onTriggered: Qt.openUrlExternally(root.imageSource)
        },
        PlasmaCore.Action {
            text: i18nd(root.domain, "Save a Copy to Pictures")
            icon.name: "document-save-symbolic"
            visible: shell.available && root.configuration.CurrentImagePath.length > 0
            onTriggered: root.saveCopy()
        }
    ]

    /* ------------------------------------------------------------ presentation */

    Rectangle {
        anchors.fill: parent
        color: root.configuration.Color
        Behavior on color {
            ColorAnimation { duration: Kirigami.Units.longDuration }
        }
    }

    Item {
        id: blurLayer
        anchors.fill: parent
        visible: root.configuration.Blur
                 && root.imageFillMode !== Image.PreserveAspectCrop
                 && root.imageFillMode !== Image.Stretch
                 && root.imageFillMode !== Image.Tile

        Image {
            id: blurSource
            anchors.fill: parent
            visible: false
            asynchronous: true
            cache: false
            autoTransform: true
            fillMode: Image.PreserveAspectCrop
            source: blurLayer.visible ? root.imageSource : ""
            sourceSize: Qt.size(480, 480)
        }

        MultiEffect {
            anchors.fill: parent
            source: blurSource
            autoPaddingEnabled: false
            blurEnabled: true
            blur: 1.0
            blurMax: 64
            visible: blurSource.status === Image.Ready
        }
    }

    QQC2.StackView {
        id: imageView
        anchors.fill: parent

        readonly property size targetSize: Qt.size(imageView.width * Screen.devicePixelRatio,
                                                   imageView.height * Screen.devicePixelRatio)
        property Item pendingImage
        property bool skipAnimation: true

        onTargetSizeChanged: Qt.callLater(imageView.loadImage)

        function loadImage() {
            if (root.imageSource.toString().length === 0) {
                return;
            }
            if (imageView.pendingImage) {
                imageView.pendingImage.statusChanged.disconnect(imageView.replaceWhenLoaded);
                imageView.pendingImage.destroy();
                imageView.pendingImage = null;
            }
            imageView.skipAnimation = imageView.empty;
            imageView.pendingImage = imageComponent.createObject(imageView, {
                "source": root.imageSource,
                "fillMode": root.imageFillMode,
                "opacity": imageView.skipAnimation ? 1 : 0,
                "sourceSize": imageView.targetSize,
                "width": imageView.width,
                "height": imageView.height,
            });
            imageView.pendingImage.statusChanged.connect(imageView.replaceWhenLoaded);
            imageView.replaceWhenLoaded();
        }

        function replaceWhenLoaded() {
            if (!imageView.pendingImage || imageView.pendingImage.status === Image.Loading) {
                return;
            }
            if (imageView.pendingImage.status === Image.Error) {
                // The cached file vanished (cleared cache, new machine): refetch.
                imageView.pendingImage.statusChanged.disconnect(imageView.replaceWhenLoaded);
                imageView.pendingImage.destroy();
                imageView.pendingImage = null;
                root.configuration.CurrentImagePath = "";
                root.update(true);
                return;
            }
            imageView.pendingImage.statusChanged.disconnect(imageView.replaceWhenLoaded);
            imageView.replace(imageView.pendingImage, {},
                              imageView.skipAnimation ? QQC2.StackView.Immediate : QQC2.StackView.Transition);
            imageView.pendingImage = null;
        }

        Component {
            id: imageComponent

            Image {
                asynchronous: true
                cache: false
                autoTransform: true
                smooth: true

                QQC2.StackView.onActivated: root.accentColorChanged()
                QQC2.StackView.onDeactivated: destroy()
                QQC2.StackView.onRemoved: destroy()
            }
        }

        replaceEnter: Transition {
            OpacityAnimator {
                id: enterAnimator
                to: 1
                duration: Math.round(Kirigami.Units.veryLongDuration * 5)
            }
        }
        replaceExit: Transition {
            PauseAnimation {
                duration: enterAnimator.duration + 500
            }
        }
    }

    InfoOverlay {
        anchors.fill: parent
        visible: root.configuration.ShowInfoOverlay && title.length > 0
        corner: root.configuration.InfoOverlayCorner
        title: root.configuration.CurrentTitle
        description: root.configuration.ShowInfoDescription ? root.configuration.CurrentDescription : ""
        credit: root.configuration.CurrentCredit
        sourceName: root.configuration.CurrentSourceName
    }

    /* ------------------------------------------------------------ wiring */

    Shell {
        id: shell
    }

    Timer {
        id: checkTimer
        repeat: true
        triggeredOnStart: false
        onTriggered: root.update(false)
    }

    /**
     * Nothing downstream is guaranteed to answer: QML's XMLHttpRequest has no
     * timeout, so a single stalled request leaves fetchAll waiting for a
     * callback that never arrives, pinning `busy` and killing rotation until
     * the next Plasma restart. This puts a ceiling on any one update.
     */
    Timer {
        id: watchdog
        interval: 300000
        repeat: false
        onTriggered: {
            root.statusMessage = i18nd(root.domain, "Timed out while fetching an image");
            console.warn("WebbScreen:", root.statusMessage);
            root.busy = false;
            root.restartRotation();
        }
    }

    Timer {
        id: rotateTimer
        repeat: true
        triggeredOnStart: false
        onTriggered: root.advance()
    }

    Timer {
        id: startupTimer
        interval: 5000
        repeat: false
        onTriggered: root.update(false)
    }

    onBusyChanged: root.busy ? watchdog.restart() : watchdog.stop()

    onImageSourceChanged: Qt.callLater(imageView.loadImage)
    onImageFillModeChanged: Qt.callLater(imageView.loadImage)

    Connections {
        target: root.configuration

        // Changing the sources invalidates the cached pool, otherwise a source
        // just switched off would keep supplying images for another 15 minutes.
        function onSourceNasaScienceChanged() { root.resetPool(); }
        function onSourceNasaChanged() { root.resetPool(); }
        function onSourceEsaChanged() { root.resetPool(); }
        function onSourceFlickrChanged() { root.resetPool(); }
        function onSourceJwstApiChanged() { root.resetPool(); }
        function onFlickrApiKeyChanged() { root.resetPool(); }
        function onSkipLowResolutionChanged() { root.resetPool(); }
        function onPhotographsOnlyChanged() { root.resetPool(); }
        function onUpdateModeChanged() { root.rescheduleTimer(); }
        function onUpdateIntervalSecondsChanged() { root.rescheduleTimer(); }
        function onCheckIntervalMinutesChanged() { root.rescheduleTimer(); }
    }

    Component.onCompleted: {
        imageView.loadImage();
        rescheduleTimer();
        startupTimer.start();
    }
}

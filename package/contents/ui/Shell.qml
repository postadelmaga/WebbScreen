/*
 * WebbScreen — thin async wrapper around the Plasma "executable" data engine.
 * SPDX-FileCopyrightText: 2026 postadelmaga
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Plasma has no QML API for writing binary files, so image downloads, HEAD
 * probes and cache housekeeping are delegated to curl / coreutils. Every job
 * gets a unique variable assignment prepended so that two identical commands
 * never collide on the data engine's source name (and so that KProcess always
 * routes through /bin/sh).
 */

import QtQuick
import org.kde.plasma.plasma5support as P5Support

Item {
    id: shell

    /// False when the executable engine could not be loaded; callers then fall
    /// back to streaming the image straight from the network. DataSource.valid
    /// is not bindable and only turns true once the engine has been loaded, so
    /// it is sampled rather than bound: use isAvailable() in imperative code and
    /// this property (kept up to date by the timer below) in bindings.
    property bool available: false

    function isAvailable() {
        if (!shell.available && executableEngine.valid) {
            shell.available = true;
        }
        return shell.available;
    }

    property int _jobCounter: 0
    property var _callbacks: ({})

    /**
     * Runs `command` through /bin/sh and invokes
     * callback({ code, stdout, stderr }) when it finishes.
     */
    function run(command, callback) {
        if (!shell.isAvailable()) {
            if (callback) {
                callback({ code: 127, stdout: "", stderr: "executable data engine unavailable" });
            }
            return;
        }
        const source = "WEBBSCREEN_JOB=" + (++shell._jobCounter) + "; " + command;
        shell._callbacks[source] = callback;
        executableEngine.connectSource(source);
    }

    /// Single-quotes a string for safe interpolation into a shell command.
    function quote(value) {
        return "'" + String(value).replace(/'/g, "'\\''") + "'";
    }

    Timer {
        interval: 250
        running: true
        repeat: false
        onTriggered: shell.isAvailable()
    }

    P5Support.DataSource {
        id: executableEngine
        engine: "executable"
        connectedSources: []

        onNewData: (sourceName, data) => {
            const callback = shell._callbacks[sourceName];
            delete shell._callbacks[sourceName];
            disconnectSource(sourceName);
            if (callback) {
                callback({
                    code: data["exit code"] !== undefined ? data["exit code"] : 1,
                    stdout: String(data["stdout"] || ""),
                    stderr: String(data["stderr"] || "")
                });
            }
        }
    }
}

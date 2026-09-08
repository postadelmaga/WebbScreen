#!/bin/sh
# Installs (or upgrades) the WebbScreen wallpaper plugin for the current user.
# SPDX-FileCopyrightText: 2026 postadelmaga
# SPDX-License-Identifier: GPL-3.0-or-later
set -eu

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PKG="$DIR/package"
ID="org.kde.webbscreen"

if ! command -v kpackagetool6 >/dev/null 2>&1; then
    echo "kpackagetool6 not found — install kf6-package / kpackage." >&2
    exit 1
fi

if kpackagetool6 --type Plasma/Wallpaper --show "$ID" >/dev/null 2>&1; then
    echo "Upgrading $ID…"
    kpackagetool6 --type Plasma/Wallpaper --upgrade "$PKG"
else
    echo "Installing $ID…"
    kpackagetool6 --type Plasma/Wallpaper --install "$PKG"
fi

echo
echo "Done. Restart Plasma to pick up the changes:"
echo "    systemctl --user restart plasma-plasmashell.service"
echo
echo "Then: right click the desktop → Configure Desktop and Wallpaper →"
echo "      Wallpaper type: \"Webb Screen\"."

#!/bin/sh
# Removes the WebbScreen wallpaper plugin and its image cache.
# SPDX-FileCopyrightText: 2026 postadelmaga
# SPDX-License-Identifier: GPL-3.0-or-later
set -eu

ID="org.kde.webbscreen"

kpackagetool6 --type Plasma/Wallpaper --remove "$ID" || true
rm -rf -- "${XDG_CACHE_HOME:-$HOME/.cache}/webbscreen"

echo "Removed $ID and its cache."

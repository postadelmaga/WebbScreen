/*
 * WebbScreen — optional caption card drawn over the wallpaper.
 * SPDX-FileCopyrightText: 2026 postadelmaga
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts

import org.kde.kirigami as Kirigami

Item {
    id: overlay

    /// 0 bottom left, 1 bottom right, 2 top left, 3 top right
    property int corner: 1
    property string title: ""
    property string description: ""
    property string credit: ""
    property string sourceName: ""

    readonly property bool atTop: overlay.corner >= 2
    readonly property bool atLeft: overlay.corner === 0 || overlay.corner === 2
    readonly property int alignment: overlay.atLeft ? Text.AlignLeft : Text.AlignRight

    readonly property real padding: Kirigami.Units.largeSpacing
    readonly property real maxContentWidth:
        Math.min(overlay.width - Kirigami.Units.gridUnit * 6, Kirigami.Units.gridUnit * 24)

    Rectangle {
        id: card

        anchors.top: overlay.atTop ? parent.top : undefined
        anchors.bottom: overlay.atTop ? undefined : parent.bottom
        anchors.left: overlay.atLeft ? parent.left : undefined
        anchors.right: overlay.atLeft ? undefined : parent.right
        anchors.margins: Kirigami.Units.gridUnit * 2

        // Hug the text, but never grow past a comfortable reading measure.
        width: Math.min(overlay.maxContentWidth,
                        Math.max(titleLabel.implicitWidth,
                                 descriptionLabel.visible ? descriptionLabel.implicitWidth : 0,
                                 creditLabel.visible ? creditLabel.implicitWidth : 0))
               + overlay.padding * 2
        height: contents.implicitHeight + overlay.padding * 2
        radius: Kirigami.Units.cornerRadius
        color: Qt.rgba(0, 0, 0, 0.55)

        ColumnLayout {
            id: contents
            anchors.fill: parent
            anchors.margins: overlay.padding
            spacing: Kirigami.Units.smallSpacing

            QQC2.Label {
                id: titleLabel
                Layout.fillWidth: true
                text: overlay.title
                color: "white"
                font.bold: true
                wrapMode: Text.WordWrap
                maximumLineCount: 2
                elide: Text.ElideRight
                horizontalAlignment: overlay.alignment
            }

            QQC2.Label {
                id: descriptionLabel
                Layout.fillWidth: true
                visible: overlay.description.length > 0
                text: overlay.description
                color: "white"
                opacity: 0.9
                wrapMode: Text.WordWrap
                maximumLineCount: 3
                elide: Text.ElideRight
                horizontalAlignment: overlay.alignment
            }

            QQC2.Label {
                id: creditLabel
                Layout.fillWidth: true
                visible: text.length > 0
                text: {
                    // "ESA/Webb, NASA & CSA" already names its source; don't repeat it.
                    const parts = [];
                    if (overlay.credit.length > 0) {
                        parts.push(overlay.credit);
                    }
                    if (overlay.sourceName.length > 0 && overlay.credit.indexOf(overlay.sourceName) === -1) {
                        parts.push(overlay.sourceName);
                    }
                    return parts.join(" · ");
                }
                color: "white"
                opacity: 0.7
                font: Kirigami.Theme.smallFont
                wrapMode: Text.WordWrap
                maximumLineCount: 2
                elide: Text.ElideRight
                horizontalAlignment: overlay.alignment
            }
        }
    }
}

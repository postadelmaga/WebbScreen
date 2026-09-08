/*
 * WebbScreen — configuration page.
 * SPDX-FileCopyrightText: 2026 postadelmaga
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts

import org.kde.kquickcontrols as KQC
import org.kde.kirigami as Kirigami

import "../code/commands.js" as Commands

Kirigami.FormLayout {
    id: root

    twinFormLayouts: parentLayout
    property alias formLayout: root

    readonly property string domain: "plasma_wallpaper_org.kde.webbscreen"

    property alias cfg_SourceNasaScience: nasaScienceCheck.checked
    property alias cfg_SourceNasa: nasaCheck.checked
    property alias cfg_SourceEsa: esaCheck.checked
    property alias cfg_SourceFlickr: flickrCheck.checked
    property alias cfg_SourceJwstApi: jwstCheck.checked
    property alias cfg_FlickrApiKey: flickrKeyField.text
    property alias cfg_JwstApiKey: jwstKeyField.text

    property int cfg_UpdateMode
    property int cfg_UpdateIntervalSeconds
    property int cfg_CheckIntervalMinutes
    property alias cfg_SwitchOnNewImage: switchOnNewCheck.checked
    property int cfg_Selection

    property alias cfg_MaxDownloadMegabytes: maxSizeSpin.value
    property alias cfg_SkipLowResolution: skipLowResCheck.checked
    property alias cfg_PhotographsOnly: photographsOnlyCheck.checked
    property alias cfg_CachedImageCount: cacheCountSpin.value

    property int cfg_FillMode
    property alias cfg_Color: colorButton.color
    property alias cfg_Blur: blurCheck.checked
    property alias cfg_ShowInfoOverlay: overlayCheck.checked
    property alias cfg_ShowInfoDescription: overlayDescriptionCheck.checked
    property int cfg_InfoOverlayCorner

    /* ------------------------------------------------------------ sources */

    Kirigami.Separator {
        Kirigami.FormData.isSection: true
        Kirigami.FormData.label: i18nd(root.domain, "Image sources")
    }

    RowLayout {
        Kirigami.FormData.label: i18nd(root.domain, "Use:")
        spacing: Kirigami.Units.smallSpacing

        QQC2.CheckBox {
            id: nasaScienceCheck
            text: i18nd(root.domain, "NASA Science — Webb releases (science.nasa.gov)")
        }

        Kirigami.ContextualHelpButton {
            toolTipText: i18nd(root.domain,
                "STScI's webbtelescope.org has been retired and now redirects here; this is where the Webb release stream ended up, and it carries the images at up to their native resolution.")
        }
    }

    RowLayout {
        spacing: Kirigami.Units.smallSpacing

        QQC2.CheckBox {
            id: nasaCheck
            text: i18nd(root.domain, "NASA Image and Video Library")
        }

        Kirigami.ContextualHelpButton {
            toolTipText: i18nd(root.domain,
                "The agency-wide archive indexes only a handful of Webb science images — mostly the July 2022 first-release set. Everything else it returns for Webb is clean-room and press-event photography, which this plugin filters out.")
        }
    }

    QQC2.CheckBox {
        id: esaCheck
        text: i18nd(root.domain, "ESA/Webb gallery (esawebb.org)")
    }

    QQC2.CheckBox {
        id: flickrCheck
        text: i18nd(root.domain, "Flickr — NASA's James Webb Space Telescope")
    }

    QQC2.CheckBox {
        id: jwstCheck
        text: i18nd(root.domain, "jwstapi.com (raw MAST previews)")
        enabled: jwstKeyField.text.trim().length > 0
    }

    RowLayout {
        Kirigami.FormData.label: i18nd(root.domain, "Flickr API key:")
        spacing: Kirigami.Units.smallSpacing

        QQC2.TextField {
            id: flickrKeyField
            Layout.preferredWidth: Kirigami.Units.gridUnit * 16
            placeholderText: i18nd(root.domain, "Optional")
        }

        Kirigami.ContextualHelpButton {
            toolTipText: i18nd(root.domain,
                "Without a key, Flickr is limited to what the public photostream feed serves, which tops out at 1024 px — so with the screen-width floor above switched on, that source contributes nothing at all. A free key from flickr.com/services/apps/create unlocks original-resolution downloads.")
        }
    }

    QQC2.TextField {
        id: jwstKeyField
        Kirigami.FormData.label: i18nd(root.domain, "jwstapi.com key:")
        Layout.preferredWidth: Kirigami.Units.gridUnit * 16
        placeholderText: i18nd(root.domain, "Required for that source")
    }

    /* ------------------------------------------------------------ updates */

    Kirigami.Separator {
        Kirigami.FormData.isSection: true
        Kirigami.FormData.label: i18nd(root.domain, "When to change wallpaper")
    }

    QQC2.ComboBox {
        id: modeCombo
        Kirigami.FormData.label: i18nd(root.domain, "Mode:")
        textRole: "label"
        valueRole: "value"
        model: [
            { label: i18nd(root.domain, "Rotate on a schedule"), value: 0 },
            { label: i18nd(root.domain, "Only when a new image is published"), value: 1 },
            { label: i18nd(root.domain, "Manually, from the desktop menu"), value: 2 }
        ]
        Component.onCompleted: currentIndex = indexOfValue(root.cfg_UpdateMode)
        onActivated: root.cfg_UpdateMode = currentValue
    }

    RowLayout {
        Kirigami.FormData.label: i18nd(root.domain, "Change every:")
        visible: root.cfg_UpdateMode === 0
        spacing: Kirigami.Units.smallSpacing

        QQC2.ComboBox {
            id: intervalCombo
            textRole: "label"
            valueRole: "value"
            model: [
                { label: i18ndc(root.domain, "@item:inlistbox Very short interval, for trying the wallpaper out", "5 seconds (for testing)"), value: 5 },
                { label: i18nd(root.domain, "30 seconds"), value: 30 },
                { label: i18nd(root.domain, "1 minute"), value: 60 },
                { label: i18nd(root.domain, "5 minutes"), value: 300 },
                { label: i18nd(root.domain, "15 minutes"), value: 900 },
                { label: i18nd(root.domain, "30 minutes"), value: 1800 },
                { label: i18nd(root.domain, "1 hour"), value: 3600 },
                { label: i18nd(root.domain, "3 hours"), value: 10800 },
                { label: i18nd(root.domain, "6 hours"), value: 21600 },
                { label: i18nd(root.domain, "12 hours"), value: 43200 },
                { label: i18nd(root.domain, "1 day"), value: 86400 },
                { label: i18nd(root.domain, "1 week"), value: 604800 }
            ]
            Component.onCompleted: {
                const index = indexOfValue(root.cfg_UpdateIntervalSeconds);
                currentIndex = index >= 0 ? index : 8;
            }
            onActivated: root.cfg_UpdateIntervalSeconds = currentValue
        }

        Kirigami.ContextualHelpButton {
            toolTipText: i18nd(root.domain,
                "Rotating moves through the images already fetched, so a short interval costs one download per change and does not re-query the sources. They are polled separately, on the interval below. You can also advance by hand at any time: right click the desktop and pick “Next Webb Image”.")
        }
    }

    QQC2.CheckBox {
        id: switchOnNewCheck
        Kirigami.FormData.label: i18nd(root.domain, "New releases:")
        text: i18nd(root.domain, "Switch as soon as a source publishes a new image")
        enabled: root.cfg_UpdateMode !== 2
    }

    QQC2.ComboBox {
        id: checkCombo
        Kirigami.FormData.label: i18nd(root.domain, "Check for new images every:")
        enabled: root.cfg_UpdateMode !== 2
        textRole: "label"
        valueRole: "value"
        model: [
            { label: i18nd(root.domain, "30 minutes"), value: 30 },
            { label: i18nd(root.domain, "1 hour"), value: 60 },
            { label: i18nd(root.domain, "3 hours"), value: 180 },
            { label: i18nd(root.domain, "6 hours"), value: 360 },
            { label: i18nd(root.domain, "1 day"), value: 1440 }
        ]
        Component.onCompleted: {
            const index = indexOfValue(root.cfg_CheckIntervalMinutes);
            currentIndex = index >= 0 ? index : 1;
        }
        onActivated: root.cfg_CheckIntervalMinutes = currentValue
    }

    QQC2.ComboBox {
        id: selectionCombo
        Kirigami.FormData.label: i18nd(root.domain, "Pick:")
        textRole: "label"
        valueRole: "value"
        model: [
            { label: i18nd(root.domain, "Most recent image not shown yet"), value: 0 },
            { label: i18nd(root.domain, "A random image"), value: 1 },
            { label: i18nd(root.domain, "Always the most recent image"), value: 2 }
        ]
        Component.onCompleted: currentIndex = indexOfValue(root.cfg_Selection)
        onActivated: root.cfg_Selection = currentValue
    }

    /* ------------------------------------------------------------ downloads */

    Kirigami.Separator {
        Kirigami.FormData.isSection: true
        Kirigami.FormData.label: i18nd(root.domain, "Downloads")
    }

    RowLayout {
        Kirigami.FormData.label: i18nd(root.domain, "Largest variant to download:")
        spacing: Kirigami.Units.smallSpacing

        QQC2.SpinBox {
            id: maxSizeSpin
            from: 1
            to: 500
            stepSize: 5
            textFromValue: (value, locale) => i18nd(root.domain, "%1 MB", value)
            valueFromText: text => parseInt(text.replace(/\D/g, ""), 10) || 25
        }

        Kirigami.ContextualHelpButton {
            toolTipText: i18nd(root.domain,
                "Every source offers the same picture in several sizes. The largest one that fits this budget is downloaded; 25 MB is enough for the full-resolution ESA/Webb releases.")
        }
    }

    RowLayout {
        Kirigami.FormData.label: i18nd(root.domain, "Quality:")
        spacing: Kirigami.Units.smallSpacing

        QQC2.CheckBox {
            id: skipLowResCheck
            text: i18nd(root.domain, "Only use images at least as wide as the screen")
        }

        Kirigami.ContextualHelpButton {
            toolTipText: i18nd(root.domain,
                "Variants narrower than your screen are discarded before they are downloaded, and a picture with nothing bigger on offer is skipped altogether. Turning this off lets small images through, upscaled. It bites hardest on Flickr without an API key, where the public feed tops out at 1024 px.")
        }
    }

    RowLayout {
        Kirigami.FormData.label: i18nd(root.domain, "Subjects:")
        spacing: Kirigami.Units.smallSpacing

        QQC2.CheckBox {
            id: photographsOnlyCheck
            text: i18nd(root.domain, "Only real photographs")
        }

        Kirigami.ContextualHelpButton {
            toolTipText: i18nd(root.domain,
                "Leaves out artist concepts, illustrations, infographics, diagrams, spectra and images with annotations drawn on them, keeping the actual telescope imagery. The sources name these plainly in the title — “(artist’s concept)”, “transmission spectrum”, “(annotated NIRCam image)” — which is what this matches on.")
        }
    }

    QQC2.SpinBox {
        id: cacheCountSpin
        Kirigami.FormData.label: i18nd(root.domain, "Keep on disk:")
        from: 1
        to: 200
        textFromValue: (value, locale) => i18ndp(root.domain, "%1 image", "%1 images", value)
        valueFromText: text => parseInt(text.replace(/\D/g, ""), 10) || 20
    }

    /* ------------------------------------------------------------ appearance */

    Kirigami.Separator {
        Kirigami.FormData.isSection: true
        Kirigami.FormData.label: i18nd(root.domain, "Appearance")
    }

    QQC2.ComboBox {
        id: fillModeCombo
        Kirigami.FormData.label: i18ndc(root.domain, "@label:listbox", "Positioning:")
        textRole: "label"
        valueRole: "value"
        model: [
            { label: i18ndc(root.domain, "@item:inlistbox", "Scaled and cropped"), value: Image.PreserveAspectCrop },
            { label: i18ndc(root.domain, "@item:inlistbox", "Scaled"), value: Image.Stretch },
            { label: i18ndc(root.domain, "@item:inlistbox", "Scaled, keep proportions"), value: Image.PreserveAspectFit },
            { label: i18ndc(root.domain, "@item:inlistbox", "Centered"), value: Image.Pad },
            { label: i18ndc(root.domain, "@item:inlistbox", "Tiled"), value: Image.Tile }
        ]
        Component.onCompleted: {
            const index = indexOfValue(root.cfg_FillMode);
            currentIndex = index >= 0 ? index : 0;
        }
        onActivated: root.cfg_FillMode = currentValue
    }

    QQC2.CheckBox {
        id: blurCheck
        Kirigami.FormData.label: i18nd(root.domain, "Background:")
        text: i18nd(root.domain, "Fill empty areas with a blurred copy")
        enabled: root.cfg_FillMode === Image.PreserveAspectFit || root.cfg_FillMode === Image.Pad
    }

    KQC.ColorButton {
        id: colorButton
        Kirigami.FormData.label: i18ndc(root.domain, "@label:chooser", "Background color:")
        dialogTitle: i18ndc(root.domain, "@title:window", "Select Background Color")
    }

    QQC2.CheckBox {
        id: overlayCheck
        Kirigami.FormData.label: i18nd(root.domain, "Caption:")
        text: i18nd(root.domain, "Show the image title and credit on the desktop")
    }

    QQC2.CheckBox {
        id: overlayDescriptionCheck
        text: i18nd(root.domain, "Include a short description of the subject")
        enabled: overlayCheck.checked
    }

    QQC2.ComboBox {
        id: cornerCombo
        Kirigami.FormData.label: i18nd(root.domain, "Caption position:")
        visible: overlayCheck.checked
        textRole: "label"
        valueRole: "value"
        model: [
            { label: i18nd(root.domain, "Bottom left"), value: 0 },
            { label: i18nd(root.domain, "Bottom right"), value: 1 },
            { label: i18nd(root.domain, "Top left"), value: 2 },
            { label: i18nd(root.domain, "Top right"), value: 3 }
        ]
        Component.onCompleted: currentIndex = indexOfValue(root.cfg_InfoOverlayCorner)
        onActivated: root.cfg_InfoOverlayCorner = currentValue
    }

    /* ------------------------------------------------------------ maintenance */

    Kirigami.Separator {
        Kirigami.FormData.isSection: true
        Kirigami.FormData.label: i18nd(root.domain, "Cache")
    }

    RowLayout {
        Kirigami.FormData.label: i18nd(root.domain, "Downloaded images:")
        spacing: Kirigami.Units.smallSpacing

        QQC2.Label {
            id: cacheLabel
            text: i18nd(root.domain, "Stored in ~/.cache/webbscreen")
        }

        QQC2.Button {
            text: i18nd(root.domain, "Empty Cache")
            icon.name: "edit-clear-all-symbolic"
            enabled: shell.available
            onClicked: {
                shell.run(Commands.clearCacheCommand(), function (result) {
                    cacheLabel.text = result.code === 0
                        ? i18nd(root.domain, "Cache emptied")
                        : i18nd(root.domain, "Could not empty the cache");
                });
            }
        }
    }

    Shell {
        id: shell
        visible: false
    }
}

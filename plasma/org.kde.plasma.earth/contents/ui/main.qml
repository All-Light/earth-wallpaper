import QtQuick
import QtQuick.Controls as Controls
import org.kde.plasma.plasmoid
import org.kde.plasma.core as PlasmaCore
import "../code/EarthMath.js" as EarthMath

WallpaperItem {
    id: root
    property var savedState: ({})
    property var homeDirection: EarthMath.EarthNative.EARTH_HOME
    property vector3d cameraPosition: Qt.vector3d(homeDirection.x*3.8, homeDirection.y*3.8, homeDirection.z*3.8)
    property var snapshotResult: null
    property Item inputRoot: null
    property bool hostReady: false
    property bool capturing: false
    property bool dragging: false
    property bool eligibleDrag: false
    property point previousPoint: Qt.point(0, 0)
    property real pendingX: 0
    property real pendingY: 0
    property real pendingWheel: 0
    property int inputRevision: 0
    property int discoverAttempts: 0
    property bool refreshing: true
    property bool waitForWeather: false
    property bool returning: false
    property real returnTick: 0
    property string loadError: ""
    property string cloudStatus: "Bundled cloud map"
    property string clockTime: ""
    property string clockDate: ""
    property var preferences: ({clouds: true, clock: true, stars: true, returnDelay: 20, quality: "high"})

    contextualActions: [
        PlasmaCore.Action { text: "Earth wallpaper settings"; icon.name: "configure"; onTriggered: settingsPopup.open() },
        PlasmaCore.Action { text: "Refresh Earth wallpaper"; icon.name: "view-refresh"; onTriggered: root.wake(true) }
    ]

    function currentCamera() { return renderer.item ? renderer.item.cameraPosition : cameraPosition }
    function persist() {
        let p = currentCamera()
        cameraPosition = Qt.vector3d(p.x,p.y,p.z)
        savedState = {camera:{x:p.x,y:p.y,z:p.z},homeDirection:homeDirection,settings:preferences}
        root.configuration.State = JSON.stringify(savedState)
        root.configuration.writeConfig()
    }
    function noteInteraction() {
        inputRevision++
        refreshing = false; capturing = false; returning = false
        settle.stop(); idleDeadline.restart()
        if (preferences.returnDelay > 0) returnDeadline.restart()
    }
    function wake(refresh) {
        if (!refresh) noteInteraction()
        refreshing = refresh
        waitForWeather = refresh
        if (!renderer.active) {
            loadError = ""; hostReady = false
            renderer.active = true
            startupTimeout.restart()
        } else if (refresh && hostReady) { renderer.item.refreshEphemeris(); settle.restart() }
    }
    function rendererReady() {
        if (!renderer.item || !renderer.item.ready) return
        hostReady = true; startupTimeout.stop(); root.loading = false
        flushInput()
        if (refreshing) { weatherGrace.restart(); if (pendingHomeReturn()) startReturn(); else settle.restart() }
        else noteInteraction()
    }
    function savePreferences() {
        preferences = Object.assign({},preferences)
        persist(); wake(false)
    }
    function updateClock() {
        let now = new Date()
        clockTime = Qt.formatTime(now, "HH:mm")
        clockDate = Qt.formatDate(now, "dddd, d MMMM")
    }
    function pendingHomeReturn() { return EarthMath.EarthNative.pendingHomeReturn(currentCamera(),homeDirection,preferences.returnDelay) }
    function saveHome() {
        let p=currentCamera(), r=Math.sqrt(p.x*p.x+p.y*p.y+p.z*p.z)
        homeDirection = {x:p.x/r,y:p.y/r,z:p.z/r}
        persist(); noteInteraction()
    }
    function resetHome() {
        homeDirection = EarthMath.EarthNative.EARTH_HOME
        persist(); wake(false); startReturn()
    }
    function startReturn() {
        if (!renderer.item || !hostReady || dragging || settingsPopup.opened) return
        returning = true; returnTick = Date.now()
    }
    function advanceReturn() {
        if (!renderer.item || dragging) { returning=false; return }
        let now=Date.now(), dt=Math.min((now-returnTick)/1000,0.25); returnTick=now
        let p=currentCamera(), radius=Math.sqrt(p.x*p.x+p.y*p.y+p.z*p.z)
        let d=EarthMath.EarthNative.slerpDirection(p,homeDirection,1-Math.exp(-dt*0.50))
        if (1-(d.x*homeDirection.x+d.y*homeDirection.y+d.z*homeDirection.z)<1e-7) {
            d=homeDirection; returning=false
        }
        renderer.item.setCamera(Qt.vector3d(d.x*radius,d.y*radius,d.z*radius))
        if (!returning) { persist(); if (!idleDeadline.running) captureAndUnload() }
    }
    // Observe existing desktop input. Never raise an input window over icons.
    function discoverDesktop(item, depth) {
        if (!item || depth > 12) return null
        if (item.isContainment === true && item.appletsLayout !== undefined && item.folderViewLayer !== undefined) return item
        for (let child of item.children || []) {
            let result = discoverDesktop(child, depth + 1)
            if (result) return result
        }
        return null
    }
    function findDesktop() {
        let top = root
        while (top.parent) top = top.parent
        inputRoot = discoverDesktop(top, 0)
        discoverAttempts++
        if (inputRoot || discoverAttempts >= 10) discovery.stop()
    }
    function emptyBackground(point) {
        if (!inputRoot) return false // Unknown containment: preserve desktop input.
        try {
            let local = inputRoot.mapToItem(root, point.x, point.y)
            if (local.x < 0 || local.y < 0 || local.x >= root.width || local.y >= root.height) return false
            let layout = inputRoot.appletsLayout
            if (!layout) return false
            for (let child of layout.children) {
                if (child.visible && child.applet !== undefined) {
                    let pos = inputRoot.mapToItem(child, point.x, point.y)
                    if (child.contains(pos)) return false
                }
            }
            if (inputRoot.isFolder) {
                let folder = inputRoot.folderViewLayer
                let grid = folder && folder.view && folder.view.view
                if (!grid || !grid.contentItem || typeof grid.indexAt !== "function") return false
                let pos = inputRoot.mapToItem(grid.contentItem, point.x, point.y)
                // Reject the whole occupied cell, including an icon's text label.
                let index=grid.indexAt(pos.x,pos.y)
                if (index>=0) {
                    if (grid.model && typeof grid.model.isBlank === "function") {
                        if (!grid.model.isBlank(index)) return false
                    } else {
                        let cell=typeof grid.itemAtIndex === "function" ? grid.itemAtIndex(index) : null
                        if (!cell || cell.blank !== true) return false
                    }
                }
            }
            return true
        } catch (error) { return false }
    }
    function flushInput() {
        if (!hostReady || !renderer.item || !(pendingX || pendingY || pendingWheel)) return
        if (pendingX || pendingY) renderer.item.orbit(pendingX,pendingY)
        if (pendingWheel) renderer.item.zoom(pendingWheel)
        pendingX=0; pendingY=0; pendingWheel=0
    }
    function captureAndUnload() {
        if (!renderer.item || !hostReady || capturing || dragging || returning || settingsPopup.opened) return
        if (pendingHomeReturn()) return
        if (refreshing && waitForWeather && renderer.item.weatherPending) return
        capturing=true
        let ticket=inputRevision
        let scale=Math.min(1,1920/Math.max(root.width,root.height))
        let accepted=renderer.item.grabToImage(function(result) {
            if (ticket!==inputRevision || !renderer.item || dragging || returning || settingsPopup.opened || pendingHomeReturn()) { capturing=false; return }
            if (!result || !result.url.toString()) { capturing=false; retryCapture.restart(); return }
            persist()
            snapshotResult=result
            still.source=result.url
            cloudStatus=renderer.item.cloudStatus
            renderer.active=false
            hostReady=false; capturing=false; root.loading=false
            idleDeadline.stop(); returnDeadline.stop(); weatherGrace.stop()
        },Qt.size(Math.max(1,Math.round(root.width*scale)),Math.max(1,Math.round(root.height*scale))))
        if (!accepted) { capturing=false; retryCapture.restart() }
    }

    Rectangle { anchors.fill: parent; color: "#010204" }
    Image { id: still; anchors.fill: parent; fillMode: Image.PreserveAspectFit; cache: false; smooth: true }
    Loader {
        id: renderer
        anchors.fill: parent
        active: false
        sourceComponent: Component {
            NativeEarth {
                cameraPosition: root.cameraPosition
                settings: root.preferences
                animate: true
                onReadyChanged: if (ready) Qt.callLater(root.rendererReady)
                onErrorChanged: if (error.length>0) { root.loadError=error; root.loading=false }
                onCloudStatusChanged: root.cloudStatus=cloudStatus
                onWeatherPendingChanged: if (!weatherPending && root.refreshing && root.hostReady) settle.restart()
            }
        }
    }
    Timer { id: weatherGrace; interval: 5000; onTriggered: { root.waitForWeather=false; root.captureAndUnload() } }
    Timer { id: settle; interval: 80; onTriggered: root.captureAndUnload() }
    Timer { id: retryCapture; interval: 1000; onTriggered: root.captureAndUnload() }
    Timer { id: idleDeadline; interval: 45000; onTriggered: root.captureAndUnload() }
    Timer { id: returnDeadline; interval: Math.max(1,root.preferences.returnDelay*1000); onTriggered: root.startReturn() }
    Timer { interval: root.preferences.quality === "high" ? 33 : root.preferences.quality === "low" ? 67 : 42; running: root.returning; repeat: true; onTriggered: root.advanceReturn() }
    Timer { interval: 900000; repeat: true; running: true; onTriggered: { if (!renderer.active && !settingsPopup.opened) root.wake(true) } }
    Timer { id: discovery; interval: 1000; repeat: true; running: true; onTriggered: root.findDesktop() }
    Timer { interval: 60000; repeat: true; running: root.preferences.clock; onTriggered: root.updateClock() }
    Timer {
        id: startupTimeout; interval: 10000
        onTriggered: { renderer.active=false; root.hostReady=false; root.loading=false; if(!root.loadError)root.loadError="Native renderer timed out. Use Refresh Earth wallpaper to retry." }
    }
    Timer { interval: root.preferences.quality === "high" ? 16 : root.preferences.quality === "low" ? 50 : 33; repeat: true; running: root.hostReady && !!(root.pendingX || root.pendingY || root.pendingWheel); onTriggered: root.flushInput() }
    PointHandler {
        parent: root.inputRoot || root
        target: null
        enabled: !!root.inputRoot && !settingsPopup.opened
        acceptedButtons: Qt.LeftButton
        grabPermissions: PointerHandler.ApprovesTakeOverByAnything
        onActiveChanged: {
            if (active) {
                root.previousPoint = point.position
                root.eligibleDrag = root.emptyBackground(point.position)
            } else {
                if (root.dragging) {
                    root.flushInput()
                    root.noteInteraction()
                }
                root.dragging = false
                root.eligibleDrag = false
            }
        }
        onPointChanged: {
            if (!active || !root.eligibleDrag) return
            let dx = point.position.x - root.previousPoint.x
            let dy = point.position.y - root.previousPoint.y
            if (!root.dragging && Math.abs(dx) + Math.abs(dy) < 4) return
            root.previousPoint = point.position
            if (!root.dragging) { root.dragging = true; root.wake(false); root.noteInteraction() }
            root.pendingX += dx; root.pendingY += dy
        }
    }
    WheelHandler {
        parent: root.inputRoot || root
        target: null
        enabled: !!root.inputRoot && !settingsPopup.opened
        blocking: false
        onWheel: function(event) {
            if (!root.emptyBackground(Qt.point(event.x, event.y))) return
            root.wake(false)
            root.pendingWheel += event.pixelDelta.y || event.angleDelta.y
            event.accepted = false
        }
    }
    Column {
        anchors.right: parent.right; anchors.bottom: parent.bottom
        anchors.rightMargin: parent.width * 0.038; anchors.bottomMargin: parent.height * 0.053
        spacing: 7; visible: root.preferences.clock
        Text { anchors.right: parent.right; text: root.clockTime; color: "#eef0f2"; font.pixelSize: Math.max(42, Math.min(76, root.width * 0.042)); font.weight: Font.ExtraLight }
        Text { anchors.right: parent.right; text: root.clockDate; color: "#a8aeb3"; font.pixelSize: Math.max(11, Math.min(15, root.width * 0.01)) }
    }
    Text {
        anchors.centerIn: parent; width: Math.min(420, parent.width - 40)
        wrapMode: Text.Wrap; color: "#bbc4d0"; text: root.loadError
        visible: root.loadError.length > 0 && !root.snapshotResult
    }
    Controls.Popup {
        id: settingsPopup
        anchors.centerIn: parent
        width: 350; padding: 20; modal: false
        closePolicy: Controls.Popup.CloseOnEscape | Controls.Popup.CloseOnPressOutside
        onOpened: root.wake(false)
        onClosed: root.noteInteraction()
        contentItem: Column {
            spacing: 10
            Text { text: "Earth wallpaper settings"; color: "#ddd"; font.bold: true }
            Controls.Switch { text: "Clock"; checked: root.preferences.clock; onToggled: { root.preferences.clock = checked; root.preferences = Object.assign({}, root.preferences); root.savePreferences() } }
            Controls.Switch { text: "Satellite clouds"; checked: root.preferences.clouds; onToggled: { root.preferences.clouds = checked; root.savePreferences() } }
            Controls.Switch { text: "Stars"; checked: root.preferences.stars; onToggled: { root.preferences.stars = checked; root.savePreferences() } }
            Controls.ComboBox { model: ["High", "Balanced", "Low power"]; currentIndex: ["high","balanced","low"].indexOf(root.preferences.quality); onActivated: { root.preferences.quality = ["high","balanced","low"][currentIndex]; root.savePreferences() } }
            Controls.ComboBox { model: ["Return after 20 seconds", "Return after 45 seconds", "Return after 90 seconds", "Do not return"]; currentIndex: [20,45,90,0].indexOf(root.preferences.returnDelay); onActivated: { root.preferences.returnDelay = [20,45,90,0][currentIndex]; root.savePreferences() } }
            Controls.Button { text: "Save current view as home"; enabled: root.hostReady; onClicked: root.saveHome() }
            Controls.Button { text: "Reset home to Rome"; enabled: root.hostReady; onClicked: root.resetHome() }
            Text { width: parent.width; wrapMode: Text.Wrap; color: "#999"; font.pixelSize: 11; text: root.inputRoot ? "Empty-background gestures enabled. Icons retain their normal actions." : "Desktop input layout could not be identified. Gestures are disabled to protect icons." }
            Text { width: parent.width; wrapMode: Text.Wrap; color: "#999"; font.pixelSize: 11; text: root.cloudStatus + "\nNASA imagery · Modified EUMETSAT data; polar clouds estimated." }
            Controls.Button { text: "Close"; onClicked: settingsPopup.close() }
        }
    }
    Component.onCompleted: {
        try { savedState=EarthMath.EarthNative.migrateSavedView(JSON.parse(root.configuration.State || "{}")) } catch (error) { savedState={} }
        if (!savedState || typeof savedState !== "object") savedState={}
        if (savedState.homeDirection) homeDirection=EarthMath.EarthNative.unit(savedState.homeDirection)
        if (savedState.camera && [savedState.camera.x,savedState.camera.y,savedState.camera.z].every(Number.isFinite)) {
            let p=savedState.camera, length=Math.hypot(p.x,p.y,p.z)
            if (length>0.001) { let r=Math.max(1.55,Math.min(4.4,length))/length; cameraPosition=Qt.vector3d(p.x*r,p.y*r,p.z*r) }
        }
        if (savedState.settings) {
            let s=savedState.settings
            preferences={clouds:s.clouds!==false,clock:s.clock!==false,stars:s.stars!==false,quality:["high","balanced","low"].indexOf(s.quality)>=0?s.quality:"high",returnDelay:[0,20,45,90].indexOf(s.returnDelay)>=0?s.returnDelay:20}
        }
        updateClock(); findDesktop(); wake(true)
    }
}

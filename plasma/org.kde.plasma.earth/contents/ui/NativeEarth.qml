import QtQuick
import "../code/EarthMath.js" as EarthMath

Item {
    id: root
    property vector3d cameraPosition: Qt.vector3d(EarthMath.EarthNative.EARTH_HOME.x*3.8, EarthMath.EarthNative.EARTH_HOME.y*3.8, EarthMath.EarthNative.EARTH_HOME.z*3.8)
    property var settings: ({ clouds: true, stars: true, quality: "high" })
    property bool animate: false
    property bool ready: false
    property string error: ""
    property string cloudStatus: "Loading bundled cloud map"
    property string cloudSourceUrl: "https://clouds.matteason.co.uk/images/4096x2048/clouds-alpha.png"
    readonly property bool weatherPending: liveClouds.status === Image.Loading
    property var cloudMap: cloudFallback
    property real sunDistance: 23480.0
    property vector3d sunVector: Qt.vector3d(1, 0, 0)
    property real moonDistance: 60.0
    property vector3d moonVector: Qt.vector3d(-1, 0, 0)
    property real moonRadius: 0.2727
    property real moonIllumination: 0.5
    property real siderealAngle: 0
    property int localLoads: 0
    property int localFailures: 0
    readonly property int textureWidth: settings.quality === "high" ? 4096 : settings.quality === "low" ? 1024 : 2048
    readonly property int expectedLocalLoads: 5
    readonly property real verticalFovDegrees: 34.0
    readonly property real cameraRadius: Math.sqrt(cameraPosition.x*cameraPosition.x + cameraPosition.y*cameraPosition.y + cameraPosition.z*cameraPosition.z)

    function refreshEphemeris() {
        try {
            const e = EarthMath.EarthNative.sample(new Date())
            sunVector = Qt.vector3d(e.sun.x, e.sun.y, e.sun.z)
            sunDistance = e.sun.distanceEarthRadii
            moonVector = Qt.vector3d(e.moon.x, e.moon.y, e.moon.z)
            moonDistance = e.moon.distanceEarthRadii
            moonRadius = e.moon.radiusEarthRadii
            moonIllumination = e.moon.illumination
            siderealAngle = e.siderealAngle
        } catch (e) {
            error = "Astronomy calculation failed: " + e
        }
    }
    function orbit(dx, dy) {
        const r = cameraRadius
        let theta = Math.atan2(cameraPosition.z, cameraPosition.x)
        let phi = Math.acos(Math.max(-1, Math.min(1, cameraPosition.y / r)))
        const scale = Math.max(0.0015, 0.0055 * (r - 1.0) / (3.8 - 1.0))
        theta -= dx * scale
        phi = Math.max(0.08, Math.min(Math.PI - 0.08, phi + dy * scale))
        const s = Math.sin(phi)
        cameraPosition = Qt.vector3d(r * s * Math.cos(theta), r * Math.cos(phi), r * s * Math.sin(theta))
    }
    function zoom(delta) {
        const r = Math.max(1.55, Math.min(4.4, cameraRadius * Math.exp(-delta * 0.0012)))
        const k = r / Math.max(0.00001, cameraRadius)
        cameraPosition = Qt.vector3d(cameraPosition.x*k, cameraPosition.y*k, cameraPosition.z*k)
    }
    function setCamera(position) {
        if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) return
        if (Math.hypot(position.x,position.y,position.z)<0.001) return
        const r = Math.max(1.55, Math.min(4.4, Math.sqrt(position.x*position.x+position.y*position.y+position.z*position.z)))
        const k = r / Math.max(0.00001, Math.sqrt(position.x*position.x+position.y*position.y+position.z*position.z))
        cameraPosition = Qt.vector3d(position.x*k,position.y*k,position.z*k)
    }
    function loadFinished() {
        localLoads++
        if (localLoads >= expectedLocalLoads && !ready) {
            if (localFailures === 0) {
                ready = true
                cloudStatus = "Bundled cloud map"
                refreshEphemeris()
                if (settings && settings.clouds) liveClouds.source = cloudSourceUrl
            }
        }
    }
    function loadFailed(name) {
        if (!error) error = "Could not load local " + name + " texture"
        localFailures++
        loadFinished()
    }
    function updateLiveCloudStatus() {
        if (liveClouds.status === Image.Ready) {
            cloudMap = liveClouds
            cloudStatus = "Live cloud map fetched " + new Date().toLocaleTimeString(Qt.locale(), "HH:mm")
        } else if (liveClouds.status === Image.Error) {
            // Keep the bundled map visible and disclose that it is the fallback.
            cloudStatus = "Bundled clouds (live feed unavailable)"
        }
    }

    onSettingsChanged: if (ready && settings && settings.clouds && !liveClouds.source.toString()) liveClouds.source = cloudSourceUrl

    Image { id: earthImage; source: "../images/earth.jpg"; asynchronous: true; cache: false; sourceSize: Qt.size(root.textureWidth,root.textureWidth/2); mipmap: true; visible: false; onStatusChanged: if(status===Image.Ready && root.localLoads<root.expectedLocalLoads) root.loadFinished(); else if(status===Image.Error && root.localLoads<root.expectedLocalLoads) root.loadFailed("Earth") }
    Image { id: nightImage; source: "../images/earth-night.jpg"; asynchronous: true; cache: false; sourceSize: Qt.size(Math.min(root.textureWidth,2048),Math.min(root.textureWidth/2,1024)); mipmap: true; visible: false; onStatusChanged: if(status===Image.Ready && root.localLoads<root.expectedLocalLoads) root.loadFinished(); else if(status===Image.Error && root.localLoads<root.expectedLocalLoads) root.loadFailed("night lights") }
    Image { id: oceanImage; source: "../images/ocean-mask.jpg"; asynchronous: true; cache: false; sourceSize: Qt.size(Math.min(root.textureWidth,2048),Math.min(root.textureWidth/2,1024)); mipmap: true; visible: false; onStatusChanged: if(status===Image.Ready && root.localLoads<root.expectedLocalLoads) root.loadFinished(); else if(status===Image.Error && root.localLoads<root.expectedLocalLoads) root.loadFailed("ocean mask") }
    Image { id: cloudFallback; source: "../images/clouds-alpha.png"; asynchronous: true; cache: false; sourceSize: Qt.size(root.textureWidth,root.textureWidth/2); mipmap: true; visible: false; onStatusChanged: if(status===Image.Ready && root.localLoads<root.expectedLocalLoads) root.loadFinished(); else if(status===Image.Error && root.localLoads<root.expectedLocalLoads) root.loadFailed("bundled cloud") }
    Image { id: moonImage; source: "../images/moon.jpg"; asynchronous: true; cache: false; sourceSize: Qt.size(Math.min(root.textureWidth/2,1024),Math.min(root.textureWidth/4,512)); mipmap: true; visible: false; onStatusChanged: if(status===Image.Ready && root.localLoads<root.expectedLocalLoads) root.loadFinished(); else if(status===Image.Error && root.localLoads<root.expectedLocalLoads) root.loadFailed("Moon") }
    Image { id: liveClouds; asynchronous: true; cache: false; sourceSize: Qt.size(root.textureWidth,root.textureWidth/2); mipmap: true; visible: false; onStatusChanged: root.updateLiveCloudStatus() }

    ShaderEffect {
        anchors.fill: parent
        blending: false
        onStatusChanged: if (status === ShaderEffect.Error) root.error = "Native shader failed: " + log
        vertexShader: "../shaders/earth.vert.qsb"
        fragmentShader: "../shaders/earth.frag.qsb"
        property vector3d cameraPosition: root.cameraPosition
        property vector3d sunVector: root.sunVector
        property real sunDistance: root.sunDistance
        property vector3d moonVector: root.moonVector
        property real moonDistance: root.moonDistance
        property real moonRadius: root.moonRadius
        property real moonIllumination: root.moonIllumination
        property real siderealAngle: root.siderealAngle
        property real cloudsEnabled: root.settings && root.settings.clouds ? 1.0 : 0.0
        property real starsEnabled: root.settings && root.settings.stars ? 1.0 : 0.0
        property real aspect: height > 0 ? width / height : 1.0
        property var earthTexture: earthImage
        property var nightTexture: nightImage
        property var oceanTexture: oceanImage
        property var cloudsTexture: root.cloudMap
        property var moonTexture: moonImage
    }

    Timer { interval: 5000; repeat: true; running: root.animate && root.visible; onTriggered: root.refreshEphemeris() }
    Component.onCompleted: refreshEphemeris()
}

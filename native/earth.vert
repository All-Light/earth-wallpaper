#version 440
layout(location = 0) in vec4 qt_Vertex;
layout(location = 1) in vec2 qt_MultiTexCoord0;
layout(location = 0) out vec2 uv;
layout(std140, binding = 0) uniform buf { mat4 qt_Matrix; float qt_Opacity; vec3 cameraPosition; vec3 sunVector; float sunDistance; vec3 moonVector; float moonDistance; float moonRadius; float moonIllumination; float siderealAngle; float cloudsEnabled; float starsEnabled; float aspect; };
void main() {
    uv = qt_MultiTexCoord0;
    gl_Position = qt_Matrix * qt_Vertex;
}

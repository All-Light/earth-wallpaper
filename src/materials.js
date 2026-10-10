import * as THREE from 'three';

const vertex = `
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vUv = uv;
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export function makeEarthMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSun: {value: new THREE.Vector3(1, 0, 0)},
      uTexture: {value: null}, uHasTexture: {value: 0},
      uNight: {value: null}, uOcean: {value: null},
      uCloud: {value: null}, uCloudOn: {value: 0}, uTime: {value: 0},
    },
    vertexShader: vertex,
    fragmentShader: `
    varying vec2 vUv;
    varying vec3 vWorld;
    varying vec3 vNormal;
    uniform vec3 uSun;
    uniform sampler2D uTexture, uNight, uOcean, uCloud;
    uniform float uHasTexture, uCloudOn;
    void main() {
      vec3 n = normalize(vNormal), l = normalize(uSun);
      vec3 view = normalize(cameraPosition - vWorld);
      float altitude = dot(n, l);
      const float twilightWidth = 0.07;
      float daylight = smoothstep(-twilightWidth, twilightWidth, altitude);
      vec3 surface = uHasTexture > 0.5 ? texture2D(uTexture, vUv).rgb : vec3(0.005, 0.015, 0.03);
      float ocean = texture2D(uOcean, vUv).r;
      surface = mix(surface, vec3(0.004, 0.022, 0.065), ocean * 0.72);
      // Project cloud shadow along the sunlight onto the surface.
      vec3 cloudPoint = normalize(n + (l - n * altitude) * 0.004 / max(altitude, 0.15));
      vec2 shadowUv = vec2(atan(-cloudPoint.z, cloudPoint.x) / 6.2831853 + 0.5,
                           asin(cloudPoint.y) / 3.14159265 + 0.5);
      float coverage = uCloudOn > 0.5 ? texture2D(uCloud, shadowUv).a : 0.0;
      float wrappedLambert = clamp((altitude + twilightWidth) / (1.0 + twilightWidth), 0.0, 1.0);
      float diffuse = pow(wrappedLambert, 0.75) * daylight;
      vec3 lit = surface * (0.008 + diffuse * 1.4) * (1.0 - coverage * 0.42);
      float specular = pow(max(dot(n, normalize(l + view)), 0.0), 95.0);
      float fresnel = 0.03 + 0.55 * pow(1.0 - max(dot(n, view), 0.0), 5.0);
      lit += vec3(1.0, 0.88, 0.72) * specular * ocean * (0.2 + fresnel) * daylight * (1.0 - coverage);
      float lights = texture2D(uNight, vUv).r;
      lit += vec3(1.0, 0.55, 0.20) * pow(lights, 1.25) * 2.0 * (1.0 - smoothstep(-0.14, 0.035, altitude)) * (1.0 - coverage * 0.85);
      gl_FragColor = vec4(lit, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  });
}

export function makeCloudMaterial(sun) {
  return new THREE.ShaderMaterial({
    uniforms: {uCloud: {value: null}, uSun: sun},
    vertexShader: vertex,
    fragmentShader: `
    varying vec2 vUv;
    varying vec3 vNormal;
    uniform sampler2D uCloud;
    uniform vec3 uSun;
    void main() {
      float density = texture2D(uCloud, vUv).a;
      float altitude = dot(normalize(vNormal), normalize(uSun));
      const float twilightWidth = 0.07;
      float daylight = smoothstep(-twilightWidth, twilightWidth, altitude);
      float wrappedLambert = clamp((altitude + twilightWidth) / (1.0 + twilightWidth), 0.0, 1.0);
      float light = pow(wrappedLambert, 0.65) * daylight;
      vec3 color = vec3(0.86, 0.91, 1.0) * (0.006 + light * 0.88);
      float twilight = exp(-pow((altitude - 0.01) / 0.055, 2.0));
      color += vec3(0.055, 0.011, 0.003) * twilight;
      gl_FragColor = vec4(color, pow(smoothstep(0.1, 1.0, density), 1.6) * 0.9);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
    transparent: true, depthWrite: false,
  });
}

export function makeAtmosphereMaterial(sun) {
  return new THREE.ShaderMaterial({
    uniforms: {uSun: sun}, vertexShader: vertex,
    fragmentShader: `
    varying vec3 vWorld;
    uniform vec3 uSun;
    vec2 sphere(vec3 o, vec3 d, float radius) {
      float b = dot(o, d), h = b * b - dot(o, o) + radius * radius;
      if(h < 0.0) return vec2(1e5, -1e5);
      h = sqrt(h); return vec2(-b - h, -b + h);
    }
    void main() {
      vec3 ray = normalize(vWorld - cameraPosition), sun = normalize(uSun);
      vec2 outer = sphere(cameraPosition, ray, 1.035);
      vec2 ground = sphere(cameraPosition, ray, 1.0);
      float start = max(outer.x, 0.0), end = min(outer.y, ground.x);
      float stepSize = max(end - start, 0.0) / 16.0;
      vec3 scatter = vec3(0.0);
      for(int i = 0; i < 16; i++) {
        vec3 p = cameraPosition + ray * (start + (float(i) + 0.5) * stepSize);
        float density = exp(-(length(p) - 1.0) * 150.0);
        float sunAltitude = dot(normalize(p), sun);
        float shadow = smoothstep(0.995, 1.007, length(cross(p, sun)));
        if(dot(p, sun) > 0.0) shadow = 1.0;
        float sunPath = 1.0 / max(0.06, sunAltitude + 0.16);
        vec3 transmittance = exp(-vec3(0.018, 0.045, 0.095) * sunPath);
        scatter += density * stepSize * shadow * transmittance;
      }
      float phase = 0.75 * (1.0 + pow(dot(ray, sun), 2.0));
      vec3 color = (1.0 - exp(-scatter * vec3(1.2, 3.6, 8.0))) * phase * 0.42;
      gl_FragColor = vec4(color, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
    transparent: true, blending: THREE.AdditiveBlending,
    side: THREE.BackSide, depthWrite: false, depthTest: false,
  });
}

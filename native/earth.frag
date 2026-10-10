#version 440
layout(location = 0) in vec2 uv;
layout(location = 0) out vec4 fragColor;
layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec3 cameraPosition;
    vec3 sunVector;
    float sunDistance;
    vec3 moonVector;
    float moonDistance;
    float moonRadius;
    float moonIllumination;
    float siderealAngle;
    float cloudsEnabled;
    float starsEnabled;
    float aspect;
};
layout(binding = 1) uniform sampler2D earthTexture;
layout(binding = 2) uniform sampler2D nightTexture;
layout(binding = 3) uniform sampler2D oceanTexture;
layout(binding = 4) uniform sampler2D cloudsTexture;
layout(binding = 5) uniform sampler2D moonTexture;
const float PI = 3.141592653589793;

vec2 mapUv(vec3 n) {
    n = normalize(n);
    return vec2(0.5 + atan(-n.z, n.x) / (2.0 * PI), 0.5 - asin(clamp(n.y,-1.0,1.0)) / PI);
}
vec2 hitSphere(vec3 ro, vec3 rd, float radius) {
    float b = dot(ro,rd);
    float h = b*b - dot(ro,ro) + radius*radius;
    if (h < 0.0) return vec2(1e20,-1e20);
    h = sqrt(h);
    return vec2(-b-h,-b+h);
}
float srgbToLinear1(float c) { return c <= 0.04045 ? c/12.92 : pow((c+0.055)/1.055,2.4); }
vec3 srgbToLinear(vec3 c) { return vec3(srgbToLinear1(c.r),srgbToLinear1(c.g),srgbToLinear1(c.b)); }
float linearToSrgb1(float c) { c=max(c,0.0); return c <= 0.0031308 ? c*12.92 : 1.055*pow(c,1.0/2.4)-0.055; }
vec3 linearToSrgb(vec3 c) { return vec3(linearToSrgb1(c.r),linearToSrgb1(c.g),linearToSrgb1(c.b)); }
float hash(vec3 p) { p=fract(p*0.1031); p+=dot(p,p.yzx+33.33); return fract((p.x+p.y)*p.z); }
vec3 rotateY(vec3 d,float a) { return vec3(cos(a)*d.x+sin(a)*d.z,d.y,-sin(a)*d.x+cos(a)*d.z); }

void main() {
    // Perspective camera: Earth remains at the center, with true lunar parallax.
    vec3 forward = normalize(-cameraPosition);
    vec3 right = cross(forward,vec3(0.0,1.0,0.0));
    if (dot(right,right) < 0.00001) right=vec3(1.0,0.0,0.0);
    right=normalize(right);
    vec3 up = normalize(cross(right,forward));
    float focal = 1.0 / tan(radians(17.0));
    vec2 screen = (uv*2.0-1.0)*vec2(aspect,-1.0);
    vec3 ray = normalize(forward*focal + right*screen.x + up*screen.y);
    vec2 earthHit=hitSphere(cameraPosition,ray,1.0);
    bool seesEarth=earthHit.y>0.0;
    float earthT=earthHit.x>0.0?earthHit.x:earthHit.y;
    vec2 moonHit=hitSphere(cameraPosition-moonVector*moonDistance,ray,moonRadius);
    bool moonIntersects=moonHit.y>0.0;
    float moonT=moonHit.x>0.0?moonHit.x:moonHit.y;
    bool seesMoon=moonIntersects && (!seesEarth || moonT<earthT);
    vec3 color=vec3(0.0015,0.003,0.009);

    // Sparse inertial star points, rotated against Earth's sidereal motion.
    if (starsEnabled>0.5 && !seesEarth && !seesMoon) {
        vec3 starDir=rotateY(ray,siderealAngle);
        vec2 grid=mapUv(starDir)*vec2(900.0,450.0);
        vec3 cell=vec3(floor(grid),17.0);
        float h=hash(cell);
        float point=1.0-smoothstep(0.06,0.25,length(fract(grid)-0.5));
        float star=step(0.994,h)*point;
        color += vec3(0.45,0.62,0.92)*star*(0.35+0.65*hash(cell+4.7));
    }

    // Solar photosphere, with angularly scaled restrained atmospheric glow.
    float sunAngular=acos(clamp(dot(ray,normalize(sunVector*sunDistance-cameraPosition)),-1.0,1.0));
    float sunRadius=asin(clamp(0.00465047*149597870.7/6371.0/sunDistance,0.0,1.0));
    bool sunOccluded=(seesEarth && earthT<sunDistance) || (seesMoon && moonT<sunDistance);
    if (!sunOccluded) {
        float glow=exp(-sunAngular/max(sunRadius*8.0,0.00001));
        float aureole=exp(-sunAngular/max(sunRadius*28.0,0.00002));
        color += vec3(1.0,0.44,0.12)*glow*0.11 + vec3(0.36,0.18,0.08)*aureole*0.028;
        if(sunAngular<sunRadius) color=mix(color,vec3(1.0,0.91,0.73),1.0-smoothstep(sunRadius*0.65,sunRadius,sunAngular));
    }

    if (seesEarth) {
        vec3 p=cameraPosition+ray*earthT;
        vec3 n=normalize(p);
        vec3 l=normalize(sunVector);
        float altitude=dot(n,l);
        const float twilight=0.105;
        float daylight=smoothstep(-twilight,twilight,altitude);
        vec2 tuv=mapUv(n);
        vec3 land=srgbToLinear(texture(earthTexture,tuv).rgb);
        float ocean=texture(oceanTexture,tuv).r;
        vec3 surface=mix(land,vec3(0.0035,0.020,0.065),ocean*0.74);
        vec3 projected=normalize(n+(l-n*altitude)*0.004/max(altitude,0.15));
        vec2 cloudUv=mapUv(projected);
        float cloud=cloudsEnabled>0.5?texture(cloudsTexture,cloudUv).a:0.0;
        float diffuse=pow(clamp((altitude+twilight)/(1.0+twilight),0.0,1.0),0.78)*daylight;
        vec3 lit=surface*(0.008+diffuse*1.4)*(1.0-cloud*0.42);
        vec3 view=normalize(cameraPosition-p);
        float spec=pow(max(dot(n,normalize(l+view)),0.0),95.0)*ocean*daylight*(1.0-cloud);
        lit+=vec3(1.0,0.88,0.72)*spec*0.22;
        float night=texture(nightTexture,tuv).r;
        float nightFade=1.0-smoothstep(-0.15,0.045,altitude);
        lit+=vec3(1.0,0.54,0.19)*pow(night,1.2)*1.8*nightFade*(1.0-cloud*0.82);
        float limb=1.0-max(dot(n,view),0.0);
        float rim=pow(limb,3.7);
        lit+=vec3(0.015,0.14,0.42)*rim*(0.20+daylight*0.24);
        float twilightGlow=exp(-pow((altitude+0.01)/0.085,2.0));
        lit+=vec3(0.23,0.075,0.022)*twilightGlow*rim*0.42;
        color=lit;
    }

    if (seesMoon) {
        vec3 p=cameraPosition+ray*moonT;
        vec3 n=normalize(p-(moonVector*moonDistance));
        // Approximate tidal lock: lunar texture north follows geographic north, near side faces Earth.
        vec3 towardEarth=normalize(-moonVector);
        vec3 north=vec3(0.0,1.0,0.0)-towardEarth*dot(towardEarth,vec3(0.0,1.0,0.0));
        if(dot(north,north)<0.0001) north=vec3(0.0,0.0,1.0);
        north=normalize(north);
        vec3 east=normalize(cross(north,towardEarth));
        vec2 muv=vec2(0.5+atan(dot(n,east),dot(n,towardEarth))/(2.0*PI),0.5-asin(clamp(dot(n,north),-1.0,1.0))/PI);
        vec3 mtex=srgbToLinear(texture(moonTexture,muv).rgb);
        vec3 lightDir=normalize(sunVector*sunDistance-moonVector*moonDistance);
        float moonDay=smoothstep(-0.055,0.07,dot(n,lightDir));
        color=mtex*(0.008+moonDay*0.98);
    }

    // A separate cloud shell, above both the surface and its projected shadows.
    vec2 cloudHit=hitSphere(cameraPosition,ray,1.002);
    float cloudT=cloudHit.x>0.0?cloudHit.x:cloudHit.y;
    if(cloudsEnabled>0.5 && cloudHit.y>0.0 && cloudT>0.0 && (!seesMoon || cloudT<moonT)) {
        vec3 n=normalize(cameraPosition+ray*cloudT);
        float density=texture(cloudsTexture,mapUv(n)).a;
        float altitude=dot(n,normalize(sunVector));
        float day=smoothstep(-0.105,0.105,altitude);
        float diffuse=pow(clamp((altitude+0.105)/1.105,0.0,1.0),0.65)*day;
        vec3 cloudColor=vec3(0.86,0.91,1.0)*(0.006+diffuse*0.88);
        cloudColor+=vec3(0.055,0.011,0.003)*exp(-pow((altitude-0.01)/0.075,2.0));
        color=mix(color,cloudColor,pow(smoothstep(0.1,1.0,density),1.6)*0.90);
    }

    // Thin blue scattering shell outside the surface, depth-aware against the globe.
    if (!seesEarth && !seesMoon) {
        vec2 shell=hitSphere(cameraPosition,ray,1.035);
        float shellT=shell.x>0.0?shell.x:shell.y;
        if(shell.y>0.0 && shellT>0.0) {
            float closestT=clamp(-dot(cameraPosition,ray),shell.x,shell.y);
            float miss=length(cameraPosition+ray*closestT);
            float halo=exp(-pow((miss-1.006)/0.014,2.0));
            float sunlit=0.18+0.82*max(dot(normalize(cameraPosition+ray*closestT),normalize(sunVector)),0.0);
            color+=vec3(0.012,0.095,0.28)*halo*sunlit*0.52;
        }
    }
    fragColor=vec4(linearToSrgb(color),qt_Opacity);
}

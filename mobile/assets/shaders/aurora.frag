#version 460 core
precision highp float;

#include <flutter/runtime_effect.glsl>

// Domain-warped FBM aurora — Wonderous 풍의 살아있는 잉크 배경.
// 시간에 따라 흐르는 브랜드 색 리본 + 비네트 + 필름 그레인.
uniform vec2 uSize;
uniform float uTime;
uniform float uIntensity; // 0~1 농도
uniform float uDark;      // 1 = 다크 테마
uniform vec3 uColorA;     // primary (emerald)
uniform vec3 uColorB;     // accent (mint)
uniform vec3 uColorC;     // highlight (amber)
uniform vec3 uBg;         // scaffold 배경색

out vec4 fragColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.55;
  for (int i = 0; i < 4; i++) {
    v += amp * vnoise(p);
    p = p * 2.03 + vec2(13.7, 7.1);
    amp *= 0.5;
  }
  return v;
}

void main() {
  vec2 frag = FlutterFragCoord().xy;
  vec2 uv = frag / uSize;
  // 종횡비 보정 좌표 (블롭이 찌그러지지 않게).
  vec2 p = vec2(uv.x * uSize.x / uSize.y, uv.y);
  float t = uTime * 0.06;

  // 2단 도메인 워핑 — 잉크가 서로를 휘감으며 흐른다.
  vec2 q = vec2(
    fbm(p * 1.3 + vec2(0.0, t)),
    fbm(p * 1.3 + vec2(5.2, 1.3) - t * 0.8)
  );
  vec2 r = vec2(
    fbm(p * 1.3 + 3.6 * q + vec2(1.7, 9.2) + t * 0.6),
    fbm(p * 1.3 + 3.6 * q + vec2(8.3, 2.8) - t * 0.4)
  );
  float f = fbm(p * 1.3 + 3.2 * r);

  // 다크 테마에선 발광을 더 키운다.
  float lift = mix(0.7, 1.0, uDark) * uIntensity;
  float bandA = smoothstep(0.32, 0.95, f) * lift;
  float bandB = smoothstep(0.42, 1.0, q.y) * lift;
  float bandC = smoothstep(0.55, 1.0, r.x) * lift;

  vec3 col = uBg;
  col = mix(col, uColorA, bandA * 0.34);
  col = mix(col, uColorB, bandB * 0.26);
  col = mix(col, uColorC, bandC * 0.12);

  // 위에서 내려오는 오로라 베일.
  float veil = (1.0 - uv.y);
  col = mix(col, uColorA, veil * veil * 0.10 * uIntensity);

  // 비네트 — 가장자리를 배경색으로 가라앉혀 콘텐츠 대비 확보.
  float vig = smoothstep(1.25, 0.42, length(uv - 0.5));
  col = mix(uBg, col, vig);

  // 필름 그레인 (프레임마다 미세하게 변주).
  float g = (hash(frag + vec2(fract(uTime) * 91.7)) - 0.5) * 0.05;
  col += g * mix(0.5, 1.0, uDark);

  fragColor = vec4(col, 1.0);
}

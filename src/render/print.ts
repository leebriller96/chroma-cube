import { Vector2 } from 'three';

/** 마지막에 화면 전체에 거는 마무리. 가장자리를 아주 옅게 눌러 시선을 모은다. */
export const FinishShader = {
  name: 'FinishShader',
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new Vector2(1, 1) },
    uVignette: { value: 0.2 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uVignette;
    varying vec2 vUv;

    float speck(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // 가장자리만 아주 옅게 눌러 시선을 가운데로 모은다
      vec2 d = vUv - 0.5;
      float edge = 1.0 - uVignette * dot(d, d) * 1.6;
      c *= edge;
      // 평면 색이 띠지지 않도록 눈에 안 보일 만큼만 흩뿌린다
      c += (speck(floor(gl_FragCoord.xy)) - 0.5) * 0.012;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }
  `,
};

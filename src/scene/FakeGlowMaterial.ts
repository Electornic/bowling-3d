import * as THREE from 'three';

/**
 * Fake Glow — 메시별 프레넬 글로우 머티리얼 (풀스크린 포스트프로세싱 없이 네온 헤일로).
 *
 * 원본: Anderson Mancini "FakeGlowMaterial" (MIT, 2024) — https://github.com/ektogamat/fake-glow-material-threejs
 * three r184용 TypeScript 포팅 + 0-dependency 내장 (OPEN_WORLD_LOBBY §12.3 "블룸 ① fake-glow").
 *
 * 왜 이 방식인가: 컴포저(UnrealBloomPass 등)를 도입하면 Engine의 `renderer.render()` 직접 호출 구조와
 * ACES 톤매핑을 함께 갈아엎어야 한다(이중 톤매핑 함정, §12.3). fake-glow는 발광체보다 살짝 큰 글로우
 * 쉘 메시에 AdditiveBlending으로 프레넬 헤일로를 그릴 뿐 풀스크린 패스가 0이라 — 파이프라인 무변경 +
 * 모바일 fill-rate 안전 + 에셋 0.
 *
 * 사용: 발광시키려는 지오메트리를 약간 키운 복제 메시에 이 머티리얼을 입혀 원본 위에 겹친다(makeGlowShell).
 */
export interface FakeGlowParameters {
  /** 헤일로 가장자리 falloff (작을수록 테두리에 얇게 몰림) */
  falloff?: number;
  /** 내부 반경 — 클수록 글로우가 가장자리로 좁아짐(중심이 비침) */
  glowInternalRadius?: number;
  /** 글로우 색 */
  glowColor?: THREE.ColorRepresentation;
  /** 선명도 */
  glowSharpness?: number;
  /** 불투명도 상한 */
  opacity?: number;
  side?: THREE.Side;
  /** 기본 false(벽 뒤에서도 보임). 구조물에 붙은 네온은 true로 가림 처리 권장 */
  depthTest?: boolean;
  blendMode?: THREE.Blending;
}

export class FakeGlowMaterial extends THREE.ShaderMaterial {
  constructor(parameters: FakeGlowParameters = {}) {
    super();

    this.vertexShader = /* glsl */ `
      varying vec3 vPosition;
      varying vec3 vNormal;

      void main() {
        vec4 modelPosition = modelMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewMatrix * modelPosition;
        vec4 modelNormal = modelMatrix * vec4(normal, 0.0);
        vPosition = modelPosition.xyz;
        vNormal = modelNormal.xyz;
      }
    `;

    this.fragmentShader = /* glsl */ `
      uniform vec3 glowColor;
      uniform float falloff;
      uniform float glowSharpness;
      uniform float glowInternalRadius;
      uniform float opacity;

      varying vec3 vPosition;
      varying vec3 vNormal;

      void main() {
        vec3 normal = normalize(vNormal);
        if(!gl_FrontFacing)
            normal *= - 1.0;
        vec3 viewDirection = normalize(cameraPosition - vPosition);
        float fresnel = dot(viewDirection, normal);
        fresnel = pow(fresnel, glowInternalRadius + 0.1);
        float falloffVal = smoothstep(0., falloff, fresnel);
        float fakeGlow = fresnel;
        fakeGlow += fresnel * glowSharpness;
        fakeGlow *= falloffVal;
        gl_FragColor = vec4(clamp(glowColor * fresnel, 0., 1.0), clamp(fakeGlow, 0., opacity));

        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `;

    this.uniforms = {
      opacity: new THREE.Uniform(parameters.opacity ?? 1.0),
      glowInternalRadius: new THREE.Uniform(parameters.glowInternalRadius ?? 6.0),
      glowSharpness: new THREE.Uniform(parameters.glowSharpness ?? 0.5),
      falloff: new THREE.Uniform(parameters.falloff ?? 0.1),
      glowColor: new THREE.Uniform(new THREE.Color(parameters.glowColor ?? '#00d5ff')),
    };

    // 원본의 setValues(parameters)는 커스텀 키(falloff 등)에 three 경고를 띄우므로 생략하고 직접 설정.
    this.depthTest = parameters.depthTest ?? false;
    this.depthWrite = false; // 글로우는 깊이버퍼를 쓰지 않음(반투명 가산) — 뒤 글로우와 겹쳐도 자연스럽게
    this.blending = parameters.blendMode ?? THREE.AdditiveBlending;
    this.transparent = true;
    this.side = parameters.side ?? THREE.DoubleSide;
  }
}

/**
 * 발광 메시에 글로우 헤일로 쉘을 붙여 반환한다 — 같은 지오메트리를 약간 키운 복제 + FakeGlowMaterial.
 * 호출부는 반환된 Mesh를 원본과 같은 부모/좌표에 add 하면 된다(쉘은 원본 기준 로컬 스케일).
 *
 * @param geometry 원본과 공유할 지오메트리(복제 메시가 참조만 — dispose는 호출부 책임)
 * @param color    글로우 색(보통 원본 emissive와 동일)
 * @param scale    원본 대비 쉘 배율. 얇은 띠는 두께축만 크게 주도록 Vector3 권장
 */
export function makeGlowShell(
  geometry: THREE.BufferGeometry,
  color: THREE.ColorRepresentation,
  scale: number | THREE.Vector3 = 1.6,
  params: FakeGlowParameters = {},
): THREE.Mesh {
  const shell = new THREE.Mesh(
    geometry,
    new FakeGlowMaterial({ glowColor: color, depthTest: true, ...params }),
  );
  if (typeof scale === 'number') shell.scale.setScalar(scale);
  else shell.scale.copy(scale);
  shell.renderOrder = 2; // 불투명 구조물 뒤에 그려 헤일로가 위에 얹히게
  return shell;
}

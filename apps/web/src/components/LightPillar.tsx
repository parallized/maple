import { useEffect, useRef } from "react";

/**
 * Light Pillar 背景(移植自 reactbits.dev/backgrounds/light-pillar,改为原生 WebGL 实现,
 * 避免引入 three.js 依赖)。全屏 ray-marching 光柱,紫粉渐变,作为授权页的氛围背景。
 */

interface LightPillarProps {
  topColor?: string;
  bottomColor?: string;
  intensity?: number;
  rotationSpeed?: number;
  glowAmount?: number;
  pillarWidth?: number;
  pillarHeight?: number;
  noiseIntensity?: number;
  pillarRotation?: number;
  /** 视场缩放:>1 时光柱图案缩小(拉远视角),<1 时放大。 */
  zoom?: number;
  quality?: "low" | "medium" | "high";
  className?: string;
}

const QUALITY = {
  low: { iterations: 24, waveIterations: 1, pixelRatio: 0.5, precision: "mediump", stepMultiplier: 1.5, fps: 30 },
  medium: { iterations: 40, waveIterations: 2, pixelRatio: 0.65, precision: "mediump", stepMultiplier: 1.2, fps: 60 },
  high: { iterations: 80, waveIterations: 4, pixelRatio: Math.min(window.devicePixelRatio, 2), precision: "highp", stepMultiplier: 1.0, fps: 60 }
} as const;

const VERTEX_SHADER = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

function fragmentShader(precision: string, iterations: number, waveIterations: number, stepMultiplier: number): string {
  return `
precision ${precision} float;

uniform float uTime;
uniform vec2 uResolution;
uniform vec3 uTopColor;
uniform vec3 uBottomColor;
uniform float uIntensity;
uniform float uGlowAmount;
uniform float uPillarWidth;
uniform float uPillarHeight;
uniform float uNoiseIntensity;
uniform float uRotCos;
uniform float uRotSin;
uniform float uPillarRotCos;
uniform float uPillarRotSin;
uniform float uWaveSin;
uniform float uWaveCos;
uniform float uZoom;
varying vec2 vUv;

/* GLSL ES 1.00 没有内置 tanh(three.js 会注入 polyfill,原生 WebGL 要自己实现)。
   用稳定形式避免 mediump 下 exp(2x) 上溢:tanh(x) = sign(x)·(1-e^{-2|x|})/(1+e^{-2|x|})。 */
vec3 tanhStable(vec3 x) {
  vec3 e = exp(-2.0 * abs(x));
  return sign(x) * (1.0 - e) / (1.0 + e);
}

const float STEP_MULT = ${stepMultiplier.toFixed(1)};
const int MAX_ITER = ${iterations};
const int WAVE_ITER = ${waveIterations};

void main() {
  vec2 uv = (vUv * 2.0 - 1.0) * vec2(uResolution.x / uResolution.y, 1.0) * uZoom;
  uv = vec2(uPillarRotCos * uv.x - uPillarRotSin * uv.y, uPillarRotSin * uv.x + uPillarRotCos * uv.y);

  vec3 ro = vec3(0.0, 0.0, -10.0);
  vec3 rd = normalize(vec3(uv, 1.0));

  float rotC = uRotCos;
  float rotS = uRotSin;

  vec3 col = vec3(0.0);
  float t = 0.1;

  for(int i = 0; i < MAX_ITER; i++) {
    vec3 p = ro + rd * t;
    p.xz = vec2(rotC * p.x - rotS * p.z, rotS * p.x + rotC * p.z);

    vec3 q = p;
    q.y = p.y * uPillarHeight + uTime;

    float freq = 1.0;
    float amp = 1.0;
    for(int j = 0; j < WAVE_ITER; j++) {
      q.xz = vec2(uWaveCos * q.x - uWaveSin * q.z, uWaveSin * q.x + uWaveCos * q.z);
      q += cos(q.zxy * freq - uTime * float(j) * 2.0) * amp;
      freq *= 2.0;
      amp *= 0.5;
    }

    float d = length(cos(q.xz)) - 0.2;
    float bound = length(p.xz) - uPillarWidth;
    float k = 4.0;
    float h = max(k - abs(d - bound), 0.0);
    d = max(d, bound) + h * h * 0.0625 / k;
    d = abs(d) * 0.15 + 0.01;

    float grad = clamp((15.0 - p.y) / 30.0, 0.0, 1.0);
    col += mix(uBottomColor, uTopColor, grad) / d;

    t += d * STEP_MULT;
    if(t > 50.0) break;
  }

  float widthNorm = uPillarWidth / 3.0;
  col = tanhStable(col * uGlowAmount / widthNorm);

  col -= fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) / 15.0 * uNoiseIntensity;

  gl_FragColor = vec4(col * uIntensity, 1.0);
}
`;
}

function parseColor(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  const num = parseInt(full, 16);
  return [((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255];
}

export function LightPillar({
  topColor = "#5227FF",
  bottomColor = "#FF9FFC",
  intensity = 1.0,
  rotationSpeed = 0.3,
  glowAmount = 0.005,
  pillarWidth = 3.0,
  pillarHeight = 0.4,
  noiseIntensity = 0.5,
  pillarRotation = 0,
  zoom = 1.0,
  quality = "medium",
  className = ""
}: LightPillarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const isLowEnd = isMobile || (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4);
    let effectiveQuality = quality;
    if (isLowEnd && quality === "high") effectiveQuality = "medium";
    if (isMobile && quality !== "low") effectiveQuality = "low";
    const settings = QUALITY[effectiveQuality];

    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: effectiveQuality === "high" ? "high-performance" : "low-power"
    }) as WebGLRenderingContext | null;
    if (!gl) {
      console.warn("[LightPillar] 当前环境不支持 WebGL,退回纯色背景。");
      return;
    }

    function compile(type: number, source: string): WebGLShader | null {
      const shader = gl!.createShader(type);
      if (!shader) return null;
      gl!.shaderSource(shader, source);
      gl!.compileShader(shader);
      if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
        console.warn("[LightPillar] shader 编译失败:", gl!.getShaderInfoLog(shader));
        gl!.deleteShader(shader);
        return null;
      }
      return shader;
    }

    const vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compile(gl.FRAGMENT_SHADER, fragmentShader(settings.precision, settings.iterations, settings.waveIterations, settings.stepMultiplier));
    if (!vertex || !fragment) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn("[LightPillar] program 链接失败:", gl.getProgramInfoLog(program));
      return;
    }
    gl.useProgram(program);

    // 全屏四边形
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPosition = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

    const uniform = (name: string) => gl.getUniformLocation(program, name);
    const uTime = uniform("uTime");
    const uResolution = uniform("uResolution");
    const uTopColor = uniform("uTopColor");
    const uBottomColor = uniform("uBottomColor");
    const uIntensity = uniform("uIntensity");
    const uGlowAmount = uniform("uGlowAmount");
    const uPillarWidth = uniform("uPillarWidth");
    const uPillarHeight = uniform("uPillarHeight");
    const uNoiseIntensity = uniform("uNoiseIntensity");
    const uRotCos = uniform("uRotCos");
    const uRotSin = uniform("uRotSin");
    const uPillarRotCos = uniform("uPillarRotCos");
    const uPillarRotSin = uniform("uPillarRotSin");
    const uWaveSin = uniform("uWaveSin");
    const uWaveCos = uniform("uWaveCos");
    const uZoom = uniform("uZoom");

    const pillarRotRad = (pillarRotation * Math.PI) / 180;
    const top = parseColor(topColor);
    const bottom = parseColor(bottomColor);
    gl.uniform3fv(uTopColor, top);
    gl.uniform3fv(uBottomColor, bottom);
    gl.uniform1f(uIntensity, intensity);
    gl.uniform1f(uGlowAmount, glowAmount);
    gl.uniform1f(uPillarWidth, pillarWidth);
    gl.uniform1f(uPillarHeight, pillarHeight);
    gl.uniform1f(uNoiseIntensity, noiseIntensity);
    gl.uniform1f(uPillarRotCos, Math.cos(pillarRotRad));
    gl.uniform1f(uPillarRotSin, Math.sin(pillarRotRad));
    gl.uniform1f(uWaveSin, Math.sin(0.4));
    gl.uniform1f(uWaveCos, Math.cos(0.4));
    gl.uniform1f(uZoom, zoom);

    function resize() {
      const width = canvas!.clientWidth;
      const height = canvas!.clientHeight;
      if (width === 0 || height === 0) return;
      canvas!.width = Math.round(width * settings.pixelRatio);
      canvas!.height = Math.round(height * settings.pixelRatio);
      gl!.viewport(0, 0, canvas!.width, canvas!.height);
      gl!.uniform2f(uResolution, canvas!.width, canvas!.height);
    }
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    let raf = 0;
    let time = 0;
    let last = performance.now();
    const frameTime = 1000 / settings.fps;
    const animate = (now: number) => {
      const delta = now - last;
      if (delta >= frameTime) {
        time += 0.016 * rotationSpeed;
        gl!.uniform1f(uTime, time);
        gl!.uniform1f(uRotCos, Math.cos(time * 0.3));
        gl!.uniform1f(uRotSin, Math.sin(time * 0.3));
        gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
        last = now - (delta % frameTime);
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      gl.deleteBuffer(buffer);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
    // 参数在授权页均为常量,只在挂载时初始化一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div aria-hidden className={`pointer-events-none ${className}`}>
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}

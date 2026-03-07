import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  staticFile,
} from 'remotion';
import { FadeUp, ScaleIn } from '../components/Animations';
import { colors, fonts } from '../styles';

const ScreenshotCard: React.FC<{
  src: string;
  delay: number;
  style?: React.CSSProperties;
}> = ({ src, delay, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const progress = spring({
    frame: Math.max(0, frame - delay),
    fps,
    config: { damping: 16, stiffness: 80, mass: 1.1 },
  });

  const scale = interpolate(progress, [0, 1], [0.88, 1]);
  const opacity = interpolate(progress, [0, 1], [0, 1]);
  const y = interpolate(progress, [0, 1], [30, 0]);

  return (
    <img
      src={src}
      style={{
        ...style,
        transform: `scale(${scale}) translateY(${y}px)`,
        opacity,
        borderRadius: 14,
        boxShadow: colors.shadow,
        border: `1px solid ${colors.border}`,
      }}
    />
  );
};

export const FeatureScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Background image animation: starts normal, drifts left and fades
  const bgProgress = spring({
    frame: Math.max(0, frame - 3),
    fps,
    config: { damping: 30, stiffness: 40, mass: 1.5 },
  });

  const bgX = interpolate(bgProgress, [0, 1], [0, -240]);
  const bgScale = interpolate(bgProgress, [0, 1], [0.65, 0.6]);
  const bgOpacity = interpolate(bgProgress, [0, 1], [0.6, 0.2]);
  const bgBlur = interpolate(bgProgress, [0, 1], [0, 6]);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: colors.bg,
        fontFamily: fonts.sans,
      }}
    >
      {/* Background blurred screenshot */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: `translate(calc(-50% + ${bgX}px), -50%) scale(${bgScale})`,
          opacity: bgOpacity,
          filter: `blur(${bgBlur}px)`,
        }}
      >
        <img
          src={staticFile('assets/maple.png')}
          style={{
            width: 1600,
            borderRadius: 16,
          }}
        />
      </div>

      {/* Left text block */}
      <div
        style={{
          position: 'absolute',
          top: 120,
          left: 100,
          zIndex: 10,
          maxWidth: 480,
        }}
      >
        <FadeUp delay={8}>
          <div
            style={{
              fontSize: 44,
              fontWeight: 700,
              color: colors.text,
              lineHeight: 1.3,
              letterSpacing: '-0.02em',
            }}
          >
            一切为了
            <br />
            交付闭环
          </div>
        </FadeUp>
        <FadeUp delay={20}>
          <div
            style={{
              fontSize: 22,
              fontWeight: 400,
              color: colors.textSecondary,
              marginTop: 20,
              lineHeight: 1.7,
            }}
          >
            连接 MCP 工具链
            <br />
            多模型对比执行
            <br />
            自动生成可读验收报告
          </div>
        </FadeUp>
      </div>

      {/* Stacked feature cards on the right */}
      <div style={{ position: 'absolute', right: 80, top: 100, zIndex: 5 }}>
        <ScreenshotCard
          src={staticFile('assets/worker-select.png')}
          delay={20}
          style={{ width: 520, display: 'block', marginBottom: 20 }}
        />
      </div>

      <div style={{ position: 'absolute', right: 220, top: 360, zIndex: 6 }}>
        <ScreenshotCard
          src={staticFile('assets/worker-config.png')}
          delay={40}
          style={{ width: 440, display: 'block' }}
        />
      </div>

      <div style={{ position: 'absolute', right: 60, top: 500, zIndex: 7 }}>
        <ScreenshotCard
          src={staticFile('assets/summary.png')}
          delay={60}
          style={{ width: 500, display: 'block' }}
        />
      </div>
    </AbsoluteFill>
  );
};

import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  staticFile,
} from 'remotion';
import { FadeUp } from '../components/Animations';
import { colors, fonts } from '../styles';

export const OutroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Logo entrance
  const logoProgress = spring({
    frame: Math.max(0, frame - 8),
    fps,
    config: { damping: 16, stiffness: 100, mass: 1 },
  });

  const logoScale = interpolate(logoProgress, [0, 1], [0.6, 1]);
  const logoOpacity = interpolate(logoProgress, [0, 1], [0, 1]);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: colors.bg,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        fontFamily: fonts.sans,
      }}
    >
      {/* Logo icon */}
      <div
        style={{
          transform: `scale(${logoScale})`,
          opacity: logoOpacity,
          marginBottom: 32,
        }}
      >
        <img
          src={staticFile('assets/tag.png')}
          style={{ width: 100, height: 100 }}
        />
      </div>

      {/* Product name */}
      <FadeUp delay={22}>
        <div
          style={{
            fontSize: 64,
            fontWeight: 800,
            color: colors.text,
            letterSpacing: '-0.03em',
          }}
        >
          MAPLE
        </div>
      </FadeUp>

      {/* CTA */}
      <FadeUp delay={36}>
        <div
          style={{
            fontSize: 24,
            fontWeight: 400,
            color: colors.textSecondary,
            marginTop: 16,
          }}
        >
          开始你的本地工作流
        </div>
      </FadeUp>
    </AbsoluteFill>
  );
};

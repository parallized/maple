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

export const AppRevealScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Image entrance animation
  const imgProgress = spring({
    frame: Math.max(0, frame - 10),
    fps,
    config: { damping: 20, stiffness: 60, mass: 1.2 },
  });

  const imgScale = interpolate(imgProgress, [0, 1], [0.92, 1]);
  const imgOpacity = interpolate(imgProgress, [0, 1], [0, 1]);
  const imgY = interpolate(imgProgress, [0, 1], [40, 0]);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: colors.bg,
        fontFamily: fonts.sans,
      }}
    >
      {/* Section title */}
      <div
        style={{
          position: 'absolute',
          top: 60,
          left: 0,
          width: '100%',
          textAlign: 'center',
        }}
      >
        <FadeUp delay={3}>
          <div
            style={{
              fontSize: 44,
              fontWeight: 700,
              color: colors.text,
              letterSpacing: '-0.02em',
            }}
          >
            本地优先，开箱即用
          </div>
        </FadeUp>
      </div>

      {/* App screenshot */}
      <div
        style={{
          position: 'absolute',
          top: 140,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-start',
        }}
      >
        <img
          src={staticFile('assets/maple.png')}
          style={{
            width: '82%',
            maxWidth: 1500,
            borderRadius: 16,
            boxShadow: colors.shadowStrong,
            border: `1px solid ${colors.border}`,
            transform: `scale(${imgScale}) translateY(${imgY}px)`,
            opacity: imgOpacity,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

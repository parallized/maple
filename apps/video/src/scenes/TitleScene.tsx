import React from 'react';
import { AbsoluteFill } from 'remotion';
import { FadeUp } from '../components/Animations';
import { colors, fonts } from '../styles';

export const TitleScene: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: colors.bg,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        fontFamily: fonts.sans,
        padding: 80,
      }}
    >
      {/* Badge */}
      <FadeUp delay={5} style={{ marginBottom: 32 }}>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 24px',
            borderRadius: 100,
            backgroundColor: colors.accentSoft,
            color: colors.accent,
            fontSize: 18,
            fontWeight: 600,
            letterSpacing: '0.04em',
          }}
        >
          MAPLE DESKTOP
        </div>
      </FadeUp>

      {/* Main headline */}
      <FadeUp delay={18} style={{ marginBottom: 28 }}>
        <div
          style={{
            fontSize: 76,
            fontWeight: 800,
            color: colors.text,
            textAlign: 'center',
            lineHeight: 1.15,
            maxWidth: 1100,
            letterSpacing: '-0.03em',
          }}
        >
          把 AI Worker
          <br />
          变成可交付的本地工作流
        </div>
      </FadeUp>

      {/* Subtitle */}
      <FadeUp delay={32}>
        <div
          style={{
            fontSize: 28,
            fontWeight: 400,
            color: colors.textSecondary,
            textAlign: 'center',
            maxWidth: 700,
            lineHeight: 1.6,
          }}
        >
          任务创建、执行、回写、验收
          <br />
          聚合在一个桌面工作台里
        </div>
      </FadeUp>
    </AbsoluteFill>
  );
};

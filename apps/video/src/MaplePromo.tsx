import React from 'react';
import { AbsoluteFill, Series } from 'remotion';
import { TitleScene } from './scenes/TitleScene';
import { AppRevealScene } from './scenes/AppRevealScene';
import { FeatureScene } from './scenes/FeatureScene';
import { OutroScene } from './scenes/OutroScene';
import { colors } from './styles';

export type MaplePromoProps = {
  title: string;
  tagline: string;
};

export const MaplePromo = (_props: MaplePromoProps) => {
  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg }}>
      <Series>
        <Series.Sequence durationInFrames={120}>
          <TitleScene />
        </Series.Sequence>

        <Series.Sequence durationInFrames={150}>
          <AppRevealScene />
        </Series.Sequence>

        <Series.Sequence durationInFrames={150}>
          <FeatureScene />
        </Series.Sequence>

        <Series.Sequence durationInFrames={120}>
          <OutroScene />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};

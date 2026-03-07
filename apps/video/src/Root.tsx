import React from 'react';
import { Composition, Folder } from 'remotion';
import { MaplePromo, type MaplePromoProps } from './MaplePromo';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';

loadInter();

const defaultProps = {
  title: 'Maple',
  tagline: '把 AI Worker 变成可交付的本地工作流',
} satisfies MaplePromoProps;

export const RemotionRoot = () => {
  return (
    <Folder name="Marketing">
      <Composition
        id="MaplePromo"
        component={MaplePromo}
        durationInFrames={540}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={defaultProps}
      />
    </Folder>
  );
};

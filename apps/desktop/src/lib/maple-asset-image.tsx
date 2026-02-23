import { useEffect, useMemo, useState } from "react";

import { parseMapleAssetUrl, resolveImageSrc } from "./maple-assets";

type MapleAssetImageProps = {
  assetUrl: string;
  alt: string;
  className?: string;
  maxHeightClassName?: string;
};

export function MapleAssetImage({
  assetUrl,
  alt,
  className = "",
  maxHeightClassName = "max-h-[320px]"
}: MapleAssetImageProps) {
  const descriptor = useMemo(() => parseMapleAssetUrl(assetUrl), [assetUrl]);
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResolvedSrc(null);

    void resolveImageSrc(assetUrl)
      .then((src) => {
        if (cancelled) return;
        setResolvedSrc(src);
      })
      .catch(() => {
        if (cancelled) return;
        setResolvedSrc(null);
      });

    return () => {
      cancelled = true;
    };
  }, [assetUrl]);

  if (!descriptor) {
    return (
      <p className={`m-0 text-muted text-[13px] ${className}`.trim()}>
        {alt || assetUrl}
      </p>
    );
  }

  if (!resolvedSrc) {
    return (
      <figure
        className={`m-0 flex flex-col gap-2 rounded-lg border border-(--color-base-300) bg-(--color-base-200)/35 p-2 ${className}`.trim()}
      >
        <div className={`w-full ${maxHeightClassName} rounded-md bg-(--color-base-200) animate-pulse`} />
        <figcaption className="text-[12px] text-muted">
          {alt || descriptor.fileName}
        </figcaption>
      </figure>
    );
  }

  return (
    <figure
      className={`m-0 flex flex-col gap-2 rounded-lg border border-(--color-base-300) bg-(--color-base-200)/35 p-2 ${className}`.trim()}
    >
      <img
        src={resolvedSrc}
        alt={alt || "maple-asset-image"}
        loading="lazy"
        className={`w-full h-auto ${maxHeightClassName} object-contain rounded-md`}
      />
      {alt ? <figcaption className="text-[12px] text-muted">{alt}</figcaption> : null}
    </figure>
  );
}


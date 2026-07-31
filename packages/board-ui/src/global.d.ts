declare module "*.png" {
  const src: string;
  export default src;
}

declare module "*.svg" {
  const src: string;
  export default src;
}

declare module "*.ttf?url" {
  const src: string;
  export default src;
}

interface ImportMeta {
  readonly env: {
    readonly DEV: boolean;
  };
}

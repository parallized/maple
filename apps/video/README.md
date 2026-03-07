# Maple Promo Video

基于 `Remotion` 的 Maple 宣传视频工程。

## 命令

- `pnpm -C apps/video dev`：打开 Remotion Studio 预览
- `pnpm -C apps/video typecheck`：执行类型检查
- `pnpm -C apps/video build`：渲染 `out/maple-promo.mp4`

## 素材

当前版本复用了仓库中的产品截图：

- `apps/video/public/assets/maple.png`
- `apps/video/public/assets/summary.png`
- `apps/video/public/assets/detail-page.png`
- `apps/video/public/assets/worker-config.png`
- `apps/video/public/assets/worker-select.png`
- `apps/video/public/assets/notice.png`
- `apps/video/public/assets/tag.png`

## 结构

- `apps/video/src/Root.tsx`：Composition 注册入口
- `apps/video/src/MaplePromo.tsx`：总时间线
- `apps/video/src/scenes/*.tsx`：分镜场景
- `apps/video/src/components/*.tsx`：通用动画 / 画面组件

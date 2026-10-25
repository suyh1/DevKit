# 界面过渡与微交互

工作台沿用现有主题、排版与业务状态。动效入口是 `src/Motion.tsx`、`src/motion-primitives.ts` 和 `src/motion.css`，桌面应用与项目中心网页共用同一套样式，无需额外动画依赖。

## 16 项覆盖清单

| 编号 | 区域 | 行为与主要接入点 |
| --- | --- | --- |
| 1 | 弹窗 | 确认框、项目与 Nginx 弹窗保留节点到退场完成；保存与搜索窗口采用原生 dialog 离散过渡。`Confirmation.tsx`、`project-components.tsx`、`ProjectCenter.tsx`、`NginxCenter.tsx`、`App.tsx`。 |
| 2 | 分类浮层 | 入场、退场与分类切换高度过渡；位置直接写入 ref，视口变化重新定位。`CategoryNavigation.tsx`。 |
| 3 | 导航和任务 | 选中背景按真实尺寸弹簧移动；任务增加、关闭、其余页签让位；工作区淡入淡出，保留编辑器。`App.tsx`。 |
| 4 | 操作按钮 | 按压、忙碌反馈、差异字符进退场，保留标签公共前后缀与最大已用宽度。反馈来自实际异步操作、HTTP 或文本任务状态。 |
| 5 | 复制 | 剪贴板成功后显示完成勾选，失败沿用原错误处理；色值等复杂按钮保留内部排版。`copyText`、`MotionButton`。 |
| 6 | 通知 | 保留原有 6 秒/带撤销 12 秒时限，加入进退场、文字和高度切换；可横向拖动关闭，撤销和关闭按钮保持可用。`MotionToast`。 |
| 7 | 折叠区 | Nginx 配置块与输出、JSON 树、帮助、项目地址和预览、坐标问题列表按真实高度过渡；收起内容不可获取焦点，相邻 summary 支持方向键/Home/End。`MotionDetails`。 |
| 8 | HTTP 状态 | 等待、失败和实际响应推动容器高度过渡；正文/响应头选中块移动，发送原地切换取消；结果到达即显示。`HttpWorkbench.tsx`。 |
| 9 | 列表 | 工具、项目、请求集合、任务和收藏色用稳定标识与 FLIP；删除视觉副本不可交互且对读屏隐藏。逐字搜索不重播动画，每批最多处理 100 项。 |
| 10 | 内部模式 | 原文/结果、源码/预览、HTTP 表单/JSON、Nginx 字段/源码使用短过渡；隐藏编辑器保留实例并设置 inert。 |
| 11 | 侧栏 | 桌面文字随收合淡出，窄屏抽屉从左侧进退，遮罩同步退出；沿用原焦点约束。 |
| 12 | 全局搜索 | 键盘或鼠标选择时移动背景，高度随结果/空状态变化；方向键和 Enter 即时响应。`CommandPalette.tsx`。 |
| 13 | 分段选择 | 测量真实 offset 几何，弹簧保留中途速度；横向溢出显示边缘渐隐，选中项自动进入视区；单一 Tab 入口与原方向键操作。`SegmentedControl.tsx`。 |
| 14 | 颜色 | 收藏色和中间色标新增、删除、让位；色标有独立标识；导出格式切换时外壳短暂淡入。色板、范围值与实际预览立即更新。`ColorWorkbench.tsx`。 |
| 15 | 文件拖入 | 文本输入和图片取色区显示流动虚线与三层纸张；文件名、编码或图片尺寸仅在真实读取成功后出现。 |
| 16 | 骨架加载 | 编辑器懒加载、项目数据到达后，占位视觉副本按实际几何渐隐到内容边界；真实内容立即可用，编辑器文字不移动、缩放或模糊。 |

## 生命周期与可访问性

- 退场浮层及其原生顶层 dialog 均设置 inert；业务回调不等待动画。再次打开时取消旧退场，避免旧动画关闭新窗口。
- 系统启用“减少动态效果”时 CSS 过渡关闭，JS 动画直接完成；运行中的弹簧下一帧到达目标，有限动画完成并清理。不支持动画 API 时直接显示最终状态。
- 卸载时取消 RAF、观察器、动画与反馈计时器。临时视觉副本不可交互，不复制编辑器实例，完成或取消后移除。
- 页签位置和尺寸不存入 React state；工作区退场采用绝对定位，避免两个页面同时参与 flex 排版而挤压编辑器。
- 高度过渡结束恢复自然高度；保留原有表格、树节点数与预览范围限制；无 `transition: all`、模拟上传进度或人为加载延时。

## 参考与取舍

实现前对比了 [Motion](https://github.com/motiondivision/motion) 的布局、弹簧、Presence 思路与 [React Transition Group](https://github.com/reactjs/react-transition-group) 的进入/退出生命周期。检索时约为 34.5k / 10.2k Stars，分别采用 MIT 和 [BSD 3-Clause](https://github.com/reactjs/react-transition-group/blob/master/LICENSE)。结合现有 React、原生窗口及编辑器保留机制，采用 UI Motion 技能原语、WAAPI 和本地 Presence，未复制上游实现或增加动画运行依赖。

原生 `display`/`overlay` 离散过渡依赖浏览器支持，参见 [MDN transition-behavior](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/transition-behavior)。应用内置 Chromium；其他浏览器不支持时原生窗口直接切换，受控弹窗仍由 Presence 退出。接口取消、复制失败、未确认的操作结果不能展示为成功。

采用 UI Motion 的 `PRIMITIVES.md` 及这些组件规范：`overlays/dialog`、`popover`、`drawer`，`navigation/tabs`，`buttons/action-button`、`copy-button`，`messages/toast`、`alert`，`expand/accordion`、`resizable-panels`，`toggles/segmented-control`，`tables/sortable-data-table`、`json-viewer`，`pickers/color-picker`，`editors/file-dropzone`，`loaders/skeleton-morph`。

## 验证

静态检查覆盖退场保留、快速反向切换、静态背景遮挡、溢出裁切、焦点、减少动态效果与清理路径；单元测试覆盖弹簧生命周期、真实复制结果、异步来源与服务端渲染语义，另运行既有业务测试、TypeScript 与生产构建。依照 UI Motion 技能，本次未启动自动化浏览器；实际观感需在应用窗口体验。

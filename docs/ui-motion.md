# 界面过渡与微交互

工作台沿用现有主题、排版与业务状态。动效入口是 `src/Motion.tsx`、`src/motion-primitives.ts` 和 `src/motion.css`，桌面应用与项目中心网页共用同一套样式，无需额外动画依赖。

桌面在“偏好设置 → 性能”选择正常模式或性能模式，运行模式会随偏好保存和导入导出。共享网页顶部可独立选择。性能模式即时跳过 CSS 动画、过渡和页面动画，关闭背景模糊，避免列表重排与骨架变形的测量工作。JAR 状态与文件日志分别改为 15 秒和 9 秒刷新，Nginx 状态改为 45 秒，Nginx 跟随日志和日志中心改为 6 秒，监控界面状态改为 15 秒。应用检查和自动恢复按主机设置执行。

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
| 16 | 骨架加载 | 编辑器首次等待超过 150 ms 时显示行号区和代码行占位，就绪后原位淡入 160 ms。项目数据到达后，占位副本按实际几何渐隐。 |

## 生命周期与可访问性

工具库卡片首次进入可见列表时按顺序轻微上滑回弹，输入搜索词时立即显示结果。卡片视图中，鼠标移动或手指触碰的位置决定倾角与高光，边缘沿分类色旋转，下缘背光缓慢呼吸。手指松开、手势取消或指针离开后回正。点击卡片主体时，支持 View Transitions 的浏览器会把卡片展开到对应任务，背景轻微缩放。

桌面顶部或共享网页的搜索胶囊从按钮位置展开，面板轮廓和圆角连续变化。快捷键仍可直接打开搜索。运行、保存、复制等操作按钮按压缩至 96%，内阴影加深，松开后略微回弹。

监控中心的耗时曲线默认跟随最新检测，拖动或使用方向键可将游标吸附到样本，顶部数字滚动至对应耗时。共享网页的窄屏导航有半屏和展开两个高度，可点击手柄切换，也可拖动，越过边界有阻力，释放时根据速度选定高度。

- 退场浮层及其原生顶层 dialog 均设置 inert；业务回调不等待动画。再次打开时取消旧退场，避免旧动画关闭新窗口。
- 系统启用“减少动态效果”时 CSS 过渡关闭，JS 动画直接完成；运行中的弹簧下一帧到达目标，有限动画完成并清理。不支持动画 API 时直接显示最终状态。
- 卸载时取消 RAF、观察器、动画与反馈计时器。临时视觉副本不可交互，不复制编辑器实例，完成或取消后移除。
- 页签位置和尺寸不存入 React state；工作区退场采用绝对定位，避免两个页面同时参与 flex 排版而挤压编辑器。
- 高度过渡结束恢复自然高度；保留原有表格、树节点数与预览范围限制；无 `transition: all`、模拟上传进度或人为加载延时。

## 参考与取舍

本轮对比了 Motion 的共享布局和 @use-gesture 的拖动边界、速度及指针捕获方案。工具库复用浏览器的共享元素快照，抽屉复用现有弹簧。拖动仅绑定在手柄上，避免和导航列表纵向滚动竞争。参考 [Motion](https://github.com/motiondivision/motion) 和 [@use-gesture 选项说明](https://use-gesture.netlify.app/docs/options/)。

实现前对比了 [Motion](https://github.com/motiondivision/motion) 的布局、弹簧、Presence 思路与 [React Transition Group](https://github.com/reactjs/react-transition-group) 的进入/退出生命周期。检索时约为 34.5k / 10.2k Stars，分别采用 MIT 和 [BSD 3-Clause](https://github.com/reactjs/react-transition-group/blob/master/LICENSE)。结合现有 React、原生窗口及编辑器保留机制，采用 UI Motion 技能原语、WAAPI 和本地 Presence，未复制上游实现或增加动画运行依赖。

原生 `display`/`overlay` 离散过渡依赖浏览器支持，参见 [MDN transition-behavior](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/transition-behavior)。应用内置 Chromium；其他浏览器不支持时原生窗口直接切换，受控弹窗仍由 Presence 退出。接口取消、复制失败、未确认的操作结果不能展示为成功。

采用 UI Motion 的 `PRIMITIVES.md` 及这些组件规范：`overlays/dialog`、`popover`、`drawer`，`navigation/tabs`，`buttons/action-button`、`copy-button`，`messages/toast`、`alert`，`expand/accordion`、`resizable-panels`，`toggles/segmented-control`，`tables/sortable-data-table`、`json-viewer`，`pickers/color-picker`，`editors/file-dropzone`，`loaders/skeleton-morph`。

## 验证

单元测试覆盖弹簧生命周期、复制结果、异步操作来源和服务端渲染语义。完成生产构建后，可用 `node scripts/smoke-desktop.mjs --design-only` 验证工作台导航、搜索、卡片与减少动态效果，用 `--monitor-only` 验证检测样本和窄屏共享页面。

导入文件名超宽时，悬停或键盘聚焦 600 ms 后以每秒 36 px 单次横移，末端停留，离开后复位。编码标识固定显示。系统减少动态或开启性能模式时，聚焦和悬停直接展开完整文件名。

折叠侧栏的图标在鼠标悬停或键盘聚焦时显示栏目名称。任务通知支持逐条撤销，展开或聚焦时暂停计时。工具卡片收藏、配色切换和文本交换均读取实际数据，系统减少动态或性能模式下仍可完成相同操作。

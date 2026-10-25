# Findings

基线工作区干净。Electron/React桌面工作台，兼容窄屏；已有部分CSS进场，但多数关闭直接卸载，hidden!important会吞掉退场。采用受控Presence和原生顶层dialog/popover离散过渡；不改变原审批、保存、IPC与网络行为。共享测量直接写ref/style，不以React state保存胶囊几何。

参考 Motion（MIT，检索页面约34.5k Stars）和React Transition Group（BSD 3-Clause，约10.2k Stars），对比布局/弹簧/Presence和挂载生命周期。依赖与兼容性取舍记录于docs/ui-motion.md；没有引入依赖或复制上游源码。MDN明确离散过渡非全浏览器Baseline，原生窗口允许无动画降级，受控弹窗仍保留节点到WAAPI完成。

共享Primitive不能与Motion.tsx只按大小写区分，Windows/TS解析冲突，命名为motion-primitives.ts。胶囊用offset几何，避免FLIP变换影响定位；工作区退场绝对定位避免双页面flex挤压；原生顶层dialog单独设置inert；Toast保留原居中变换。窄屏收起使用drawer-closed，避免桌面66px规则缩小退出中的抽屉。

# 功能文档与打包约定

- 根目录 `README.md` 由 `scripts/update-readme.mjs` 生成，不直接编辑。
- 新增、删除或调整工具时，维护工具注册表中的名称、description 和 `src/catalog.ts` 分类；生成器读取与界面相同的注册表。
- 修改工作台、项目中心、存储、部署或打包功能时，同步更新 `docs/README.template.md` 中对应说明及相关专题文档。生成器不会从算法代码推断使用说明。
- 所有发行打包入口必须在制作或汇总产物前完成 README 生成；生成失败应停止打包。Python 独立服务入口也应覆盖直接调用场景。
- 完成相关修改后运行 `npm run docs:update` 和 `npm run test:docs`；单独检查文档是否同步可运行 `npm run docs:check`。

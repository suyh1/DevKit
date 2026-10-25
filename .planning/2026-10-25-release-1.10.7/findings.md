# Findings

- origin=https://github.com/suyh1/DevKit.git，main；远端main与本地基线9f4c1e4一致。
- 最新Release/tag为1.10.6，包含3安装包、项目服务ZIP、摘要及验收材料。新版本1.10.7。
- gh未安装；Git Credential Manager保存的现有凭据可调用GitHub API，账户suyh1。凭据只留进程内，不打印或写入文件。
- Electron45三平台ZIP与官方SHASUMS已缓存于artifacts/electron-downloads；打包脚本支持DEVKIT_ELECTRON_ZIP_DIR核验复用。
- Python使用C:/Users/17695/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe。
- bundle:all顺序构建3平台；bundle:project-server单独生成ZIP；所有入口先生成README；verify:release核对跨平台构建指纹。
- CI为push main自动触发4个作业，Windows含既有Electron回归，CI只上传artifact，不公开Release。

最终交付：v1.10.7，4个发行文件与8个校验/验收附件，GitHub Release已公开，12项服务端摘要与本地一致。标签1.10.7指向45e4f642；CI run40201783659四项全部成功。发布记录归档不改变产品源码和已验证产物。

## git

在工作目录中查看和管理 Git 版本历史。

检查当前分支和改动。

```sh
git status --short --branch
```

查看最近五条提交。

```sh
git log -5 --oneline
```

## git status

展示 Git 仓库中文件的变更情况。 列出与当前检出提交相比有修改、新增和删除的文件。

显示修改过但尚未暂存（以备提交）的文件。

```sh
git status
```

以简短形式输出。

```sh
git status -s
```

显示暂存区与工作目录的详细变更信息。

```sh
git status -vv
```

以简短形式输出，同时包含分支信息。

```sh
git status -sb
```

显示当前贮藏区（stash）中的条目数量。

```sh
git status --show-stash
```

## git add

将更改的文件添加到索引（暂存区）。

添加单个文件到索引。

```sh
git add 路径/到/文件
```

添加所有文件（包括已跟踪的和未跟踪的）。

```sh
git add -A
```

从当前文件夹开始递归地添加所有文件。

```sh
git add .
```

只添加已跟踪的文件。

```sh
git add -u
```

忽略的文件也添加。

```sh
git add -f 路径/到/文件
```

## git diff

显示已跟踪文件的内容变更。

显示未暂存的更改。

```sh
git diff
```

显示所有未提交的更改（包括已暂存的）。

```sh
git diff HEAD
```

仅显示已暂存（添加过但未提交）的更改。

```sh
git diff --staged
```

显示过去某段时间内所有提交的变更（日期表达式如“1 week 2 days”或 ISO 日期）。

```sh
git diff 'HEAD@{3 months}'
```

显示差异统计信息（如文件变更列表、直方图及总行数增删）。

```sh
git diff --stat 提交
```

## git log

查看提交历史。

按时间先后顺序列出当前仓库所有的提交，最近的更新排在最上面。

```sh
git log
```

查看指定文件或指定目录的历史，包括每次提交所引入的差异。

```sh
git log -p 路径/到/文件或目录
```

显示每次提交的文件修改统计信息。

```sh
git log --stat
```

在日志旁以 ASCII 图形显示当前分支提交历史，并只展示提交消息的第一行。

```sh
git log --oneline --graph
```

在日志旁以 ASCII 图形显示整个仓库的所有提交、标签、分支。

```sh
git log --oneline --decorate --all --graph
```

## git show

查看某次提交的说明和改动。

显示最近提交的文件统计。

```sh
git show --stat HEAD
```

## git branch

管理分支。

列出所有分支（包括本地的和远程的；当前分支以 `*` 突出表示）。

```sh
git branch -a
```

列出哪些分支在其历史中包含指定的提交记录。

```sh
git branch -a --contains 提交的哈希值
```

显示当前分支的名称。

```sh
git branch --show-current
```

基于当前提交创建新分支。

```sh
git branch 分支名
```

基于指定提交创建新分支。

```sh
git branch 分支名 提交的哈希值
```

## git switch

切换 Git 分支。要求 Git 版本在 2.23 以上。

切换到一个已有的分支。

```sh
git switch 分支名字
```

创建并切换到一个新分支。

```sh
git switch -c 分支名字
```

创建并切换到基于某个提交的新分支。

```sh
git switch -c 分支名字 指定提交
```

切换到之前的分支。

```sh
git switch -
```

切换到一个分支，并更新所有匹配的子模块。

```sh
git switch --recurse-submodules 分支名字
```

## git restore

从索引或指定提交恢复文件状态。

取消单个文件的暂存，保留工作区编辑。

```sh
git restore --staged -- README.md
```

## git commit

将文件提交到仓库。

将暂存的文件提交到仓库，附带提交说明信息。

```sh
git commit -m "信息"
```

提交暂存的文件，并从指定文件中读取附带的提交信息。

```sh
git commit -F 路径/到/提交信息文件
```

自动暂存并提交所有修改过的和删除的文件，附带提交信息。

```sh
git commit -a -m "信息"
```

提交暂存的文件，并使用指定的 GPG 密钥签名（若未指定参数则使用配置文件中的设定）。

```sh
git commit -S 密钥id -m "信息"
```

将当前暂存的更改追加到最近一次提交，并更新其哈希值。

```sh
git commit --amend
```

## git stash

保存或查看暂时搁置的工作区修改。

列出保存的贮藏。

```sh
git stash list
```

## git tag

列出或创建 Git 标签。

列出符合版本模式的标签。

```sh
git tag --list 'v*'
```

## git fetch

从配置的远端更新跟踪引用。

获取 origin 的最新引用。

```sh
git fetch origin
```

## git pull

从远程仓库获取分支，并将其合并到本地仓库。

从默认的远程仓库拉取代码并执行合并。

```sh
git pull
```

从默认的远程仓库拉取代码并采用变基策略实现合并（将你的本地提交“移植”到远程获取的分支上）。

```sh
git pull -r
```

从给定的远程仓库和分支中拉取代码，并合并到本地对应分支。

```sh
git pull 远程仓库名 分支名
```

## git push

推送提交到远程仓库。

将当前分支的本地更改推送到其默认的远程对应分支。

```sh
git push
```

将指定本地分支的更改推送到其远程对应分支。

```sh
git push 远程仓库名 本地分支名
```

将指定本地分支的更改推送到其远程对应分支，并将该远程分支设为该本地分支 push/pull 的默认目标分支。

```sh
git push -u 远程仓库名 本地分支名
```

将指定本地分支的更改推送到指定的远程分支。

```sh
git push 远程仓库名 本地分支名:远程分支名
```

将所有本地分支的更改推送到指定远程仓库中各个对应分支。

```sh
git push --all 远程仓库名
```

## git clone

克隆现有的代码仓库。

克隆一个现有的代码仓库到指定目录。

```sh
git clone 远程代码库地址 路径/到/目录
```

克隆一个现有的代码库和它的子模块。

```sh
git clone --recursive 远程代码库地址
```

仅克隆现有代码仓库的 `.git` 目录。

```sh
git clone -n 远程_代码仓库_地址
```

克隆一个本地的代码库。

```sh
git clone -l 路径/到/本地/代码库名
```

静默克隆，不打印任何日志。

```sh
git clone -q 远程代码库地址
```

## git merge

合并分支。

将指定分支合并到当前分支。

```sh
git merge 分支名
```

编辑合并说明信息。

```sh
git merge -e 分支名
```

合并分支，创建合并提交。

```sh
git merge --no-ff 分支名
```

遇到冲突时中止合并。

```sh
git merge --abort
```

采用特定的策略进行合并。

```sh
git merge -s 策略 -X 策略选项 分支名
```

## git rebase

将 commits 从一个分支合并到另一个分支上。 常用于跨分支的 commits 合并，在被合并分支的最头部构建新的 `commit`，表示合并完成。

在另一个分支的头节点合并当前分支。

```sh
git rebase 目标分支
```

启动交互式的合并任务，允许对提交的内容进行重新排序、省略、合并或修改。

```sh
git rebase -i 目标分支或 commit 的 hash
```

处理完冲突文件后，继续执行合并任务。

```sh
git rebase --continue
```

跳过冲突文件，继续执行合并任务。

```sh
git rebase --skip
```

终止正在执行中的合并任务（例如：对于正处于解决冲突中的任务，将其打断，恢复到合并前的状态）。

```sh
git rebase --abort
```

## git blame

显示文件每一行的最后修改者和提交哈希值。

显示文件的每一行，包含作者名字和提交哈希值。

```sh
git blame 路径/到/文件
```

显示文件的每一行，包含作者邮箱和提交哈希值。

```sh
git blame -e 路径/到/文件
```

显示文件在指定提交时的每一行，包含作者名字和提交哈希值。

```sh
git blame commit 路径/到/文件
```

显示文件在指定提交之前的每一行，包含作者名字和提交哈希值。

```sh
git blame commit~ 路径/到/文件
```

显示指定行范围内的作者名字和提交哈希值信息。

```sh
git blame -L start_line,end_line 路径/到/文件
```

## git remote

管理跟踪的远程仓库（remotes）。

列出已经存在的远程仓库，包括它们的名字和 URL。

```sh
git remote -v
```

查看某个远程仓库的信息。

```sh
git remote show 远程仓库名字
```

添加远程仓库。

```sh
git remote add 远程仓库名字 远程仓库url
```

更改远程仓库地址链接（使用 `--add` 选项不会移除现有的 URL）。

```sh
git remote set-url 远程仓库名字 新url
```

查看远程仓库的 URL。

```sh
git remote get-url 远程仓库名字
```

## git help

显示 Git 的帮助信息。

显示指定 Git 子命令的帮助信息。

```sh
git help subcommand
```

在网络浏览器中显示指定 Git 子命令的帮助信息。

```sh
git help -w subcommand
```

列出所有可用的 Git 子命令。

```sh
git help -a
```

列出可用的指南。

```sh
git help -g
```

列出所有配置变量的名称。

```sh
git help -c
```

译文与示例节选自 [tldr-pages 团队及贡献者](https://github.com/tldr-pages/tldr/tree/ab12845965343cfecb51bf2d4db03f3f1f1c75b9/pages.zh)，依照 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 许可整理。DevKit 按主题重编，简化了示例占位符，并补充了部分说明和用法。

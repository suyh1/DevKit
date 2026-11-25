## curl

通过 URL 传输数据。

查看网站的 HTTP 响应头。

```sh
curl -I https://example.org
```

跟随重定向，将网页保存为本地文件。

```sh
curl -L -o page.html https://example.org
```

## wget

从网络上下载文件。 支持 HTTP，HTTPS 和 FTP。

将该 URL 的内容下载到文件中（在这个例子中文件名为 "foo"）。

```sh
wget https://example.com/foo
```

将该 URL 的内容下载到文件中（在这个例子中文件名为 "bar"）。

```sh
wget -O bar https://example.com/foo
```

以每三秒一个请求的速度下载一个网页和其所有资源（脚本，样式表，图片等等）。

```sh
wget -pkw 3 https://example.com/somepage.html
```

从一个目录中下载所有列出的文件和其所有子文件夹（不下载内嵌网页）。

```sh
wget -mnp https://example.com/somepath/
```

限制下载速度和重试次数。

```sh
wget --limit-rate 300k -t 100 https://example.com/somepath/
```

## aria2c

快速下载工具。 支持 HTTP(S)、FTP、SFTP、BitTorrent 和 Metalink。

将特定 URI 下载到一个文件。

```sh
aria2c "url"
```

从一个 URI 下载文件，并指定输出文件名。

```sh
aria2c -o 路径/到/文件 "url"
```

并行下载多个不同的文件。

```sh
aria2c -Z "url1" "url2" ...
```

从不同的镜像下载相同的文件，并验证已下载文件的校验和。

```sh
aria2c --checksum sha-256=hash "url1" "url2" ...
```

下载文件中列出的 URI，并指定并行下载的数量。

```sh
aria2c -i 路径/到/文件 -j 下载数
```

## rsync

一种快速，通用，远程（和本地）文件复制工具，默认使用 SSH。 如果要指定远程路径，请使用 `user@host:path/to/file_or_directory`。

复制文件。

```sh
rsync 路径/到/来源 路径/到/目标
```

使用归档模式递归拷贝文件，并保留所有属性，不解析软链接。

```sh
rsync -a 路径/到/来源 路径/到/目标
```

将文件以归档模式并保留几乎所有属性进行传输，并以人类可读方式输出详细信息和进度条，中断时保留部分信息。

```sh
rsync -zvhP 路径/到/来源 路径/到/目标
```

以递归模式传输文件。

```sh
rsync -r 路径/到/来源 路径/到/目标
```

将目录下的所有内容（不包含该目录），以递归方式传输。

```sh
rsync -r 路径/到/来源/ 路径/到/目标
```

## rclone

在本地与多种云服务之间复制、同步或移动文件和目录。

启动交互式菜单来配置 rclone。

```sh
rclone config
```

列出 rclone 远程目录的内容。

```sh
rclone lsf 远程名:路径/到/目录
```

将文件或目录从本地计算机复制到远程目标。

```sh
rclone copy 路径/到/本地文件或目录 远程名:路径/到/目录
```

将过去 24 小时内修改过的文件从本地复制到远程，并向用户逐个文件确认。

```sh
rclone copy -i --max-age 24h 远程名:路径/到/目录 路径/到/本地目录
```

镜像特定的文件或目录（注意：与 copy 不同，sync 会将远程中本地不存在的文件删除）。

```sh
rclone sync 路径/到/文件或目录 远程名:路径/到/目录
```

## scp

安全的复制文件。 使用 SSH 上的安全复制协议在主机之间复制文件。

将本地文件复制到远程主机。

```sh
scp 路径/到/本地文件 远程主机地址:路径/到/远程文件
```

连接到远程主机时使用特定端口。

```sh
scp -P 端口 路径/到/本地文件 远程主机地址:路径/到/远程文件
```

将文件从远程主机复制到本地目录。

```sh
scp 远程主机地址:路径/到/远程文件 路径/到/本地目录
```

递归地将目录内容从远程主机复制到本地目录。

```sh
scp -r 远程主机地址:路径/到/远程目录 路径/到/本地目录
```

通过本地主机在两个远程主机之间复制文件。

```sh
scp -3 主机地址1:路径/到/远程文件 主机地址2:路径/到/远程目录
```

## sftp

通过 SSH 进行交互式文件传输。

以指定用户连接文件服务器，在提示符下用 ls 浏览目录。

```sh
sftp 用户名@主机名
```

## ssh

通过加密连接登录获准访问的远程 Linux 主机。

用指定账号登录主机。

```sh
ssh 用户名@主机名
```

指定 SSH 服务端口。

```sh
ssh -p 2222 用户名@主机名
```

## ssh-keygen

创建 SSH 密钥或查看已有公钥信息。

显示本机已有公钥的指纹。

```sh
ssh-keygen -lf ~/.ssh/id_ed25519.pub
```

## ssh-add

在 ssh 代理中管理加载的 ssh 密钥。 需要确保 ssh 代理已启动并正在运行以加载其中的密钥。

将 `~/.ssh` 中的默认 SSH 密钥添加到 SSH 代理。

```sh
ssh-add
```

向 ssh 代理添加指定密钥。

```sh
ssh-add 路径/到/私钥文件
```

列出当前加载的密钥的指纹。

```sh
ssh-add -l
```

从 ssh 代理中删除密钥。

```sh
ssh-add -d 路径/到/私钥文件
```

从 ssh 代理中删除所有当前已有的密钥。

```sh
ssh-add -D
```

## ssh-agent

为会话内使用的 SSH 密钥提供代理。

在新的 Bash 会话中启动代理。

```sh
ssh-agent bash
```

## ssh-copy-id

在远程机器的 authorized_keys 中安装您的公钥。

将您的密钥复制到远程主机。

```sh
ssh-copy-id 用户名@远程主机
```

将给定的公钥文件复制到远程主机。

```sh
ssh-copy-id -i 路径/到/公钥文件 用户名@远程主机
```

将给定的公钥文件通过特定端口复制到远程主机。

```sh
ssh-copy-id -i 路径/到/公钥文件 -p 端口 用户名@远程主机
```

## unison

双向文件同步工具。

同步两个目录（第一次同步这两个目录时会创建日志）。

```sh
unison 路径/到/目录1 路径/到/目录2
```

自动接受（无冲突的）默认值。

```sh
unison 路径/到/目录1 路径/到/目录2 -auto
```

使用模式忽略某些文件。

```sh
unison 路径/到/目录1 路径/到/目录2 -ignore 模式
```

查看文档。

```sh
unison -doc 主题
```

译文与示例节选自 [tldr-pages 团队及贡献者](https://github.com/tldr-pages/tldr/tree/ab12845965343cfecb51bf2d4db03f3f1f1c75b9/pages.zh)，依照 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 许可整理。DevKit 按主题重编，简化了示例占位符，并补充了部分说明和用法。

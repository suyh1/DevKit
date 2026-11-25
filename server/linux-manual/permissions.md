## id

查看用户编号、主组和附加组。

仅显示当前用户的组名。

```sh
id -Gn
```

## who

显示当前登录用户和相关信息（进程，启动时间）。

显示用户名，终端线路，和所有当前登录会话的时间。

```sh
who
```

显示所有可用信息。

```sh
who -a
```

显示所有可用信息，包含表格首部名称。

```sh
who -aH
```

## whoami

显示当前有效用户的登录名。

检查本次命令以哪个用户身份运行。

```sh
whoami
```

## users

显示已登录用户的列表。

输出已登录的用户名。

```sh
users
```

根据指定的文件输出已登录的用户名。

```sh
users /var/log/wmtp
```

## w

显示已登录用户及其进程信息。

显示所有当前已登录用户的信息。

```sh
w
```

显示指定用户的信息。

```sh
w 用户名
```

显示已登录用户信息，但不显示标题行。

```sh
w -h
```

显示信息时不包含登录时间、JCPU 和 PCPU 列。

```sh
w -s
```

## last

从登录记录中读取最近的登录会话。

列出最近五条记录。

```sh
last -n 5
```

## groups

列出用户所属的组。

列出当前用户的组。

```sh
groups
```

## getent

按系统名称服务配置查询账号、组或主机。

查看当前账号的数据库记录。

```sh
getent passwd "$USER"
```

## passwd

修改账户口令或查询口令状态。

在使用 shadow-utils 的系统中只查看当前账号口令状态。

```sh
passwd -S "$USER"
```

## chage

查看与管理本机账号的口令有效期。

查看当前账号的有效期信息。

```sh
chage -l "$USER"
```

## useradd

创建本地用户，或查看创建用户时使用的默认设置。

查看默认主组、家目录和 Shell 设置。

```sh
useradd -D
```

## adduser

添加用户的工具。

创建一个新用户，在默认路径创建 home 目录，并提示用户设置密码。

```sh
adduser 用户名
```

创建一个新用户，不生成 home 目录。

```sh
adduser --no-create-home 用户名
```

创建一个新用户，并在指定路径下创建 home 目录。

```sh
adduser --home home 路径 用户名
```

创建一个新用户，并指定登录 shell。

```sh
adduser --shell shell 路径 用户名
```

创建一个新用户，并指定其用户组。

```sh
adduser --ingroup 用户组 用户名
```

## usermod

调整本地用户属性。

将已有用户加入附加组，同时保留其原有组成员关系。

```sh
sudo usermod -aG developers alice
```

## groupadd

创建新的本地用户组。

创建项目协作组。

```sh
sudo groupadd developers
```

## su

切换 shell 到另一个用户。

切换到超级用户（需要 root 密码）。

```sh
su
```

切换到指定用户（需要输入该用户的密码）。

```sh
su 用户名
```

切换到指定用户并模拟一个完整的登录 shell。

```sh
su - 用户名
```

以另一个用户身份执行命令。

```sh
su - 用户名 -c "命令"
```

## sudo

以超级用户或其他用户身份执行单个命令。

以超级用户身份运行命令。

```sh
sudo less /var/log/syslog
```

以超级用户身份使用默认编辑器编辑文件。

```sh
sudo -e /etc/fstab
```

以其他用户和(或)组的身份运行命令。

```sh
sudo -u 用户 -g 组 id -a
```

重复执行上一条以`sudo`为前缀的命令（仅适用于 Bash、Zsh 等）。

```sh
sudo !!
```

以超级用户权限启动默认 Shell，并运行登录特定的文件（如`.profile`、`.bash_profile`等）。

```sh
sudo -i
```

## chmod

修改文件或目录的访问权限。

授予所有者［u］执行［x］文件的权限。

```sh
chmod u+x 文件
```

授予所有者［u］读［r］和写［w］文件或目录的权限。

```sh
chmod u+rw 文件或目录
```

移除用户组［g］的文件执行［x］权限。

```sh
chmod g-x 文件
```

授予所有用户［a］读［r］以及执行［x］文件的权限。

```sh
chmod a+rx 文件
```

授予其他用户［o］（不在所有者用户组）和用户组［g］同样的权限。

```sh
chmod o=g 文件
```

## chown

修改用户和用户组对文件或目录的所有权。

修改文件或目录的所有者。

```sh
chown 用户 路径/到/文件或目录
```

修改文件或目录的所有者及所属组。

```sh
chown 用户:用户组 路径/到/文件或目录
```

将所有者用户和用户组都更改为 `user`。

```sh
chown user: 路径/到/文件_或_目录
```

递归修改目录及其子目录和文件的所有者。

```sh
chown -R 用户 路径/到/目录
```

修改符号链接的所有者。

```sh
chown -h 用户 路径/到/符号链接
```

## chgrp

改变文件所属的用户组。

将工作文件交给当前用户所属的 developers 组。

```sh
chgrp developers report.txt
```

## umask

读取或设置当前 Shell 创建文件时使用的权限掩码。

以符号方式查看当前掩码。

```sh
umask -S
```

## getfacl

读取文件或目录的访问控制列表。

列出共享目录的基本权限及附加授权。

```sh
getfacl shared
```

## lsattr

查看支持扩展属性的文件系统上的文件标志。

查看配置文件的属性。

```sh
lsattr config.ini
```

## getcap

显示文件具有的 Linux capabilities。

检查 ping 程序的能力标记。

```sh
getcap /usr/bin/ping
```

译文与示例节选自 [tldr-pages 团队及贡献者](https://github.com/tldr-pages/tldr/tree/ab12845965343cfecb51bf2d4db03f3f1f1c75b9/pages.zh)，依照 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 许可整理。DevKit 按主题重编，简化了示例占位符，并补充了部分说明和用法。

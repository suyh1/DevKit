## df

显示文件系统磁盘空间使用情况的概览。

显示磁盘使用情况。

```sh
df
```

以可读的形式显示磁盘使用情况。

```sh
df -h
```

显示给定文件或目录的磁盘使用情况。

```sh
df 路径/到/文件或目录
```

包括空闲 inode 数量的统计信息。

```sh
df -i
```

显示文件系统但排除指定的类型。

```sh
df -x squashfs -x tmpfs
```

## du

磁盘使用率：估计和汇总文件和目录空间使用率。

以给定单位（B/KiB/MiB）列出目录和所有子目录的大小。

```sh
du -b 路径/到/目录
```

以可读形式列出目录和任何子目录的大小（即自动转换为的合适的单位）。

```sh
du -h 路径/到/目录
```

以可读单位显示目录大小。

```sh
du -sh 路径/到/目录
```

列出目录以及其中所有文件和目录的可读大小。

```sh
du -ah 路径/到/目录
```

列出目录和任何子目录的可读大小，最多可达 N 级。

```sh
du -h -d N 路径/到/目录
```

## duf

磁盘占用/空闲实用工具。

列出可访问设备。

```sh
duf
```

列出所有（如伪文件系统，重复文件系统或不可访问的文件系统）。

```sh
duf --all
```

只显示指定的设备或挂载点。

```sh
duf 路径/到/文件夹1 路径/到/文件夹2 ...
```

根据指定条件排序输出。

```sh
duf --sort size
```

显示或隐藏指定文件系统。

```sh
duf --only-fs tmpfs
```

## lsblk

列出设备信息。

以树状格式列出所有存储设备。

```sh
lsblk
```

同时列出空设备。

```sh
lsblk -a
```

以字节为单位而不是以人类可读的格式打印 SIZE 列。

```sh
lsblk -b
```

输出文件系统信息。

```sh
lsblk -f
```

使用 ASCII 字符进行树形格式化。

```sh
lsblk -i
```

## blkid

列出所有已识别的分区及其通用唯一标识符 (UUID)。

列出所有分区。

```sh
sudo blkid
```

列出表中的所有分区，包括当前挂载点。

```sh
sudo blkid -o list
```

## findmnt

检索当前挂载的文件系统。

查询某路径所在的文件系统及挂载点。

```sh
findmnt --target /var/log
```

## mount

显示挂载信息，或将文件系统接到目录树中。

列出已挂载的 ext4 文件系统。

```sh
mount -t ext4
```

## umount

将文件系统与其挂载点解除链接，使其不再可访问。 当文件系统正在使用时，无法卸载。

卸载文件系统，通过传递挂载源的路径。

```sh
umount 路径/到/设备文件
```

卸载文件系统，通过传递挂载目标的路径。

```sh
umount 路径/到/挂载目录
```

卸载所有已挂载的文件系统（`proc` 文件系统除外）。

```sh
umount -a
```

## mountpoint

判断路径是否为挂载点。

检查 /home 是否单独挂载。

```sh
mountpoint /home
```

## fdisk

查看或编辑磁盘分区表。

列出可见磁盘的分区信息，完整信息可能需要管理员权限。

```sh
fdisk -l
```

仅查看指定磁盘的分区布局。

```sh
fdisk -l /dev/sda
```

## parted

查看磁盘的分区方式和几何信息。

列出磁盘及分区。

```sh
parted -l
```

以 MiB 显示指定磁盘的分区起止位置。

```sh
parted /dev/sda unit MiB print
```

## sfdisk

查看分区表，也能导出可读的分区布局。

将指定磁盘的分区表写到标准输出。

```sh
sfdisk --dump /dev/sda
```

## blockdev

查询块设备的属性。

读取设备以字节计的大小。

```sh
sudo blockdev --getsize64 /dev/sda
```

## swapon

查看或启用交换设备。

列出正在使用的交换区。

```sh
swapon --show
```

## btrfs

一种基于写时复制（COW）原理的 Linux 文件系统。 此命令也有关于其子命令的文件，例如：`device`。

创建子卷。

```sh
sudo btrfs su c 指向子卷的路径
```

列出子卷。

```sh
sudo btrfs su l 指向挂载点的路径
```

显示空间使用情况信息。

```sh
sudo btrfs f df 指向挂载点的路径
```

启用配额（quota）。

```sh
sudo btrfs qu e 指向子卷的路径
```

显示配额（quota）。

```sh
sudo btrfs qg s 指向子卷的路径
```

## btrfs filesystem

管理 btrfs 文件系统。

显示文件系统使用情况（可以选择以 root 身份运行以显示详细信息）。

```sh
btrfs filesystem usage 指向挂载点的路径
```

显示各个设备的使用情况。

```sh
sudo btrfs filesystem show 指向挂载点的路径
```

对 btrfs 文件系统上的单个文件进行碎片整理（避免在运行数据去重的同时运行）。

```sh
sudo btrfs filesystem defragment -v 指向文件的路径
```

递归对目录进行碎片整理（不跨越子卷边界）。

```sh
sudo btrfs filesystem defragment -v -r 指向目录的路径
```

强制将未写入的数据块同步到磁盘。

```sh
sudo btrfs filesystem sync 指向挂载点的路径
```

## btrfs subvolume

管理 btrfs 子卷和快照。

创建一个新的空子卷。

```sh
sudo btrfs su c 指向新子卷的路径
```

列出指定文件系统中的所有子卷和快照。

```sh
sudo btrfs su l 指向 btrfs 文件系统的路径
```

删除一个子卷。

```sh
sudo btrfs su d 指向子卷的路径
```

创建现有子卷的只读快照。

```sh
sudo btrfs su sn -r 指向源子卷的路径 指向目标的路径
```

创建现有子卷的读写快照。

```sh
sudo btrfs su sn 指向源子卷的路径 指向目标的路径
```

## lvs

列出 LVM 逻辑卷。

查看逻辑卷名、卷组和大小。

```sh
sudo lvs -o lv_name,vg_name,lv_size
```

## pvs

列出 LVM 物理卷。

显示物理卷与所属卷组。

```sh
sudo pvs -o pv_name,vg_name,pv_size
```

## vgs

列出 LVM 卷组。

查看卷组的总量与可用空间。

```sh
sudo vgs -o vg_name,vg_size,vg_free
```

## quota

显示用户的磁盘空间使用情况和分配限制。

以人类可读的单位显示当前用户的磁盘配额。

```sh
quota -s
```

详细输出（同时显示未分配存储的文件系统上的配额）。

```sh
quota -v
```

安静输出（仅显示使用超过配额的文件系统上的配额）。

```sh
quota -q
```

打印当前用户所属组的配额。

```sh
quota -g
```

显示其他用户的磁盘配额。

```sh
sudo quota -u 用户名
```

## smartctl

读取支持 SMART 的磁盘健康信息。

查询磁盘自报的健康状态。

```sh
sudo smartctl -H /dev/sda
```

## sync

要求系统把已修改的数据写回存储设备。

将文件系统缓冲区中的数据写回。

```sh
sync
```

译文与示例节选自 [tldr-pages 团队及贡献者](https://github.com/tldr-pages/tldr/tree/ab12845965343cfecb51bf2d4db03f3f1f1c75b9/pages.zh)，依照 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 许可整理。DevKit 按主题重编，简化了示例占位符，并补充了部分说明和用法。

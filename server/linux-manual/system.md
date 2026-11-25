## uname

输出关于当前机器和运行在该机器上的操作系统的详细信息。

打印内核名称。

```sh
uname
```

打印所有可用的系统信息。

```sh
uname -a
```

打印系统架构和处理器信息。

```sh
uname -mp
```

打印内核名称、内核版本号和内核版本。

```sh
uname -srv
```

打印系统主机名。

```sh
uname -n
```

## hostname

显示或设置系统的主机名。

显示本机的主机名。

```sh
hostname
```

显示主机名的网络地址。

```sh
hostname -i
```

显示 FQDN（完全限定域名）。

```sh
hostname -f
```

设置本机主机名。

```sh
hostname 新主机名
```

## hostnamectl

显示主机名及操作系统信息。

查看主机身份和内核版本。

```sh
hostnamectl status
```

## lsb_release

提供某些 LSB（Linux 标准库）和特定于发行版的信息。

打印所有可用信息。

```sh
lsb_release -a
```

打印操作系统的描述（通常是全名）。

```sh
lsb_release -d
```

仅打印操作系统名称 (ID)，隐藏字段名称。

```sh
lsb_release -is
```

打印发行版的版本号和代号，隐藏字段名称。

```sh
lsb_release -rcs
```

## arch

显示系统的机器硬件名称。

检查当前系统架构。

```sh
arch
```

## systemd-analyze

分析系统启动耗时及单元依赖。

列出启动花费时间较多的单元。

```sh
systemd-analyze blame
```

## dmidecode

以人类可读的格式显示 DMI（也称为 SMBIOS）表内容。 需要 root 权限。

显示所有 DMI 表内容。

```sh
sudo dmidecode
```

显示 BIOS 版本。

```sh
sudo dmidecode -s bios-version
```

显示系统的序列号。

```sh
sudo dmidecode -s system-serial-number
```

显示 BIOS 信息。

```sh
sudo dmidecode -t bios
```

显示 CPU 信息。

```sh
sudo dmidecode -t processor
```

## lspci

列出所有 PCI 设备。

显示设备的简要列表。

```sh
lspci
```

显示额外信息。

```sh
lspci -v
```

显示处理每个设备的驱动程序和模块。

```sh
lspci -k
```

显示特定设备。

```sh
lspci -s 00:18.3
```

以可读形式转储信息。

```sh
lspci -vm
```

## lsusb

枚举 USB 总线与设备。

按树形显示设备、端口与驱动。

```sh
lsusb -t
```

## neofetch

命令行系统信息工具，以美观的方式显示系统信息。

显示系统信息。

```sh
neofetch
```

在输出中显示或隐藏指定的信息行，'信息名称'是配置文件中的函数名称，例如 memory。

```sh
neofetch --enable 信息名称
```

隐藏或显示操作系统架构信息。

```sh
neofetch --os_arch on
```

启用或禁用输出中的 CPU 品牌信息。

```sh
neofetch --cpu_brand on
```

## acpi

显示电池状态或热量信息。

显示电池信息。

```sh
acpi
```

显示热量（温度）信息。

```sh
acpi -t
```

显示冷却设备信息。

```sh
acpi -c
```

用华氏度单位显示热量（温度）信息。

```sh
acpi -tf
```

显示所有信息。

```sh
acpi -V
```

## lsmod

列出已装载的内核模块。

显示模块大小和引用数。

```sh
lsmod
```

## modinfo

查看可用内核模块的说明及元数据。

查询模块的文件位置。

```sh
modinfo -F filename loop
```

## udevadm

查询设备的 udev 属性。

显示块设备已登记的键值属性。

```sh
udevadm info --query=property --name=/dev/sda
```

## timedatectl

查看系统时钟、时区和同步信息。

列出当前时间配置。

```sh
timedatectl status
```

## locale

查看当前语言与地区设置。

列出已安装的区域名称。

```sh
locale -a
```

译文与示例节选自 [tldr-pages 团队及贡献者](https://github.com/tldr-pages/tldr/tree/ab12845965343cfecb51bf2d4db03f3f1f1c75b9/pages.zh)，依照 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 许可整理。DevKit 按主题重编，简化了示例占位符，并补充了部分说明和用法。

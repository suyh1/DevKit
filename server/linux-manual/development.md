## make

Makefile 文件描述目标的任务运行器。 通常用于控制源代码中可执行文件的编译。

调用 Makefile 中指定的第一个目标（通常命名为 "all"）。

```sh
make
```

调用指定目标。

```sh
make 目标
```

调用一个指定的目标，一次并行执行 4 个作业。

```sh
make -j 4 目标
```

使用指定的 Makefile 文件。

```sh
make -f 文件
```

从另一个目录执行 make。

```sh
make -C 文件夹
```

## cmake

跨平台构建自动化系统，可为原生构建系统生成构建文件。

在当前目录中，根据项目目录中的 `CMakeLists.txt` 生成构建文件。

```sh
cmake 路径/到/项目目录
```

使用指定目录中已生成的构建文件来构建产物。

```sh
cmake --build 路径/到/构建目录
```

将构建产物安装到 `/usr/local/` 并去除调试符号。

```sh
cmake --install 路径/到/构建目录 --strip
```

生成构建文件，并通过 CMake 变量将构建类型设置为 `Release`。

```sh
cmake 路径/到/项目目录 -D CMAKE_BUILD_TYPE=Release
```

使用指定的生成器为底层构建系统生成构建文件。

```sh
cmake -G 生成器名称 路径/到/项目目录
```

## ninja

一个快速的构建系统。

在当前目录下构建。

```sh
ninja
```

在当前目录下构建，最多并行执行 4 个作业。

```sh
ninja -j 4
```

在指定的目录中构建一个程序。

```sh
ninja -C 路径
```

查看 target（如 `install` 和 `uninstall`）。

```sh
ninja -t targets
```

显示帮助。

```sh
ninja -h
```

## ctest

运行由 CMake 项目登记的测试。

在构建目录中执行测试并显示失败输出。

```sh
ctest --test-dir build --output-on-failure
```

## gcc

预处理和编译 C 和 C++ 源文件，然后汇编并将他们链接起来。 GCC (GNU Compiler Collection) 项目的组件之一。

将一组源文件编译为二进制文件。

```sh
gcc 源/文件/的路径1.cpp 源/文件/的路径2.cpp ... -o 可执行/文件/的路径
```

打印所有错误和警告。

```sh
gcc 源/文件/的路径.cpp -Wall -o output_executable
```

打印普通警告和调试信息, 并在不影响调试的情况下优化。

```sh
gcc 源/文件/的路径.cpp -Wall -g -Og -o 可执行/文件/的路径
```

包含与源文件不在同一路径下的库。

```sh
gcc 源/文件/的路径.c -o 可执行/文件/的路径 -I头/文件/的目录 -L库/的目录 -l库的名字
```

将源文件编译为汇编指令。

```sh
gcc -S 源/文件/的路径
```

## g++

编译 C++ 源文件。 GCC (GNU Compiler Collection) 项目的组件之一。

将一组源文件编译为二进制文件。

```sh
g++ 源/文件/的路径1.cpp 源/文件/的路径2.cpp ... -o 可执行/文件/的路径
```

打印所有错误和警告。

```sh
g++ 源/文件/的路径.cpp -Wall -o output_executable
```

打印普通警告和调试信息, 并在不影响调试的情况下优化。

```sh
g++ 源/文件/的路径.cpp -Wall -g -Og -o 可执行/文件/的路径
```

指定 C++ 语言标准 (C++98/C++11/C++14/C++17)。

```sh
g++ 源/文件/的路径.cpp -std=c++98 -o 可执行/文件/的路径
```

包含与源文件不在同一路径下的库。

```sh
g++ 源/文件/的路径.c -o 可执行/文件/的路径 -I头/文件/的目录 -L库/的目录 -l库的名字
```

## clang

编译 C，C++ 以及 Objective-C 源文件。可以无缝替代 GCC。 LLVM 项目的组件之一。

将多个文件编译为可执行文件。

```sh
clang 源/文件/的路径1.c 源/文件/的路径2.c ... -o 可执行/文件/的路径
```

打印所有错误和警告。

```sh
clang 源/文件/的路径.c -Wall -o 可执行文件
```

打印普通警告和调试信息, 并在不影响调试的情况下优化。

```sh
clang 源/文件/的路径.c -Wall -g -Og -o 可执行/文件/的路径
```

包含与源文件不在同一路径下的库。

```sh
clang 源/文件/的路径.c -o 可执行/文件/的路径 -I头/文件/的目录 -L库/的目录 -l库的名字
```

将源文件编译为 LLVM 中间表示（IR）。

```sh
clang -S -emit-llvm 源/文件/的路径.c -o IR/的/路径.ll
```

## clang++

编译 C++ 源文件。 LLVM 项目的组件之一。

将一组源文件编译为二进制文件。

```sh
clang++ 源/文件/的路径1.cpp 源/文件/的路径2.cpp ... -o 可执行/文件/的路径
```

打印所有错误和警告。

```sh
clang++ 源/文件/的路径.cpp -Wall -o 可执行文件
```

打印普通警告和调试信息, 并在不影响调试的情况下优化。

```sh
clang++ 源/文件/的路径.cpp -Wall -g -Og -o 可执行/文件/的路径
```

指定 C++ 语言标准。

```sh
clang++ 源/文件/的路径.cpp -std=c++20 -o 可执行/文件/的路径
```

包含与源文件不在同一路径下的库。

```sh
clang++ 源/文件/的路径.cpp -o 可执行/文件/的路径 -I头/文件/的目录 -L库/的目录 -l库的名字
```

## ld

将目标文件链接在一起。

将一个没有依赖项的特定目标文件链接到可执行文件中。

```sh
ld 路径/到/文件.o -o 路径/到/输出_可执行文件
```

将两个目标文件链接在一起。

```sh
ld 路径/到/文件1.o 路径/到/文件2.o -o 路径/到/输出_可执行文件
```

将一个 x86_64 程序动态链接到 glibc (文件路径根据系统而变化)。

```sh
ld -o 路径/到/输出_可执行文件 -I /lib/ld-linux-x86-64.so.2 /lib/crt1.o /lib/crti.o -lc 路径/到/文件.o /lib/crtn.o
```

## as

一个可移植的 GUN 汇编器。 主要用于汇编`gcc`的输出，以供链接器`ld`使用。

汇编一个文件，输出为 a.out。

```sh
as 路径/到/文件.s
```

汇编文件，并指定输出文件。

```sh
as 路径/到/文件.s -o 路径/到/输出.o
```

通过跳过空格和注释的预处理过程来更快的产生输出文件（只应该用于可信任的编译器的输出）。

```sh
as -f 路径/到/文件.s
```

将给定路径添加到目录列表，来搜索.include 指令指定的文件。

```sh
as -I 目标文件夹 路径/到/文件.s
```

## nm

列出目标文件中的符号。

显示本地目标文件中定义的符号。

```sh
nm --defined-only app.o
```

## objdump

查看目标文件的节、符号和其他信息。

查看本地构建产物的节头。

```sh
objdump -h app.o
```

## readelf

显示 EFI 文件信息。

显示 ELF 所有文件信息。

```sh
readelf -all path/to/binary
```

显示 ELF 文件的所有头信息。

```sh
readelf --headers path/to/binary
```

如果存在符号表项，则显示 ELF 文件内的符号表项。

```sh
readelf --symbols path/to/binary
```

显示 ELF 文件头信息。

```sh
readelf --file-header path/to/binary
```

## size

统计目标文件各段占用的空间。

查看编译产物各段的字节数。

```sh
size app.o
```

## ldd

查看可信本机程序依赖的共享库。

显示系统 ls 程序使用的动态库。

```sh
ldd /bin/ls
```

## addr2line

将二进制文件地址转换成文件名和行数。

显示可执行文件的指令地址对应源代码的文件名和行数。

```sh
addr2line -e 可执行文件路径 地址
```

显示函数名、文件名和行数。

```sh
addr2line -e 可执行文件路径 -f 地址
```

将 C++ 代码函数名符号重组。

```sh
addr2line -e 可执行文件地址 -f -C 地址
```

## pkg-config

查询开发库的编译和链接参数。

获取编译链接 zlib 所需的标志。

```sh
pkg-config --cflags --libs zlib
```

## ranlib

为静态库生成符号索引。

更新本地构建的静态库索引。

```sh
ranlib libsample.a
```

## shellcheck

静态检查 Shell 脚本。

查看脚本的可移植性与引用问题。

```sh
shellcheck build.sh
```

## shfmt

格式化或检查 Shell 脚本的缩进。

预览格式化前后的差异。

```sh
shfmt -d build.sh
```

## ccache

缓存 C/C++ 的编译结果。

查看当前缓存命中统计。

```sh
ccache -s
```

译文与示例节选自 [tldr-pages 团队及贡献者](https://github.com/tldr-pages/tldr/tree/ab12845965343cfecb51bf2d4db03f3f1f1c75b9/pages.zh)，依照 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 许可整理。DevKit 按主题重编，简化了示例占位符，并补充了部分说明和用法。

## awk

一种用于文件处理的通用编程语言。

以空格为分隔符，打印文件每行第五列（也称作字段）。

```sh
awk '{print $5}' 文件名
```

以空格为分隔符，打印文件包含“foo” 的所有行的第二列。

```sh
awk '/foo/ {print $2}' 文件名
```

以逗号而不是空格作为分隔符，打印文件每行的最后一列。

```sh
awk -F ',' '{print $NF}' 文件名
```

计算文件的第一列数值之和并打印。

```sh
awk '{s+=$1} END {print s}' 文件名
```

从第一行开始，每三行打印一行。

```sh
awk 'NR%3==1' 文件名
```

## sed

以脚本方式编辑文本。

将所有输入行中出现的 `apple`（基本正则语法）替换为 `mango`（基本正则语法），并将结果打印到 `stdout`。

```sh
命令 | sed 's/apple/mango/g'
```

将所有输入行中出现的 `apple`（扩展正则语法）替换为 `APPLE` （扩展正则语法），并将结果打印到 `stdout`。

```sh
命令 | sed -E 's/(apple)/\U\1/g'
```

用 `mango`（基本正则语法）替换特定文件中出现的所有 `apple`（基本正则语法），并覆盖原文件。

```sh
sed -i 's/apple/mango/g' 路径/到/文件
```

执行特定的脚本，并将结果打印到 `stdout`。

```sh
命令 | sed -f 路径/到/脚本.sed
```

打印第一行到 `stdout`。

```sh
命令 | sed -n '1p'
```

## cut

从标准输入或文件中剪切字段。

打印每行的特定字符/或属性范围。

```sh
命令 | cut --characters 1
```

打印每行由指定分隔符分割的属性范围。

```sh
命令 | cut -d "分隔符" -f 1
```

打印文件每行的字符范围。

```sh
cut -c 1 路径/到/文件
```

打印以 `NUL` 结尾的行的特定字段（例如 `find . -print0`）而不是换行符。

```sh
命令 | cut -z -f 1
```

## paste

合并文件行。

将所有行合并为一行，使用 tab 作为分隔符。

```sh
paste -s 路径/到/文件
```

使用指定的分隔符将所有行合并为一行。

```sh
paste -s -d 分隔符 路径/到/文件
```

并排合并两个文件，每个文件以 tab 分隔为单独的列。

```sh
paste 路径/到/文件1 路径/到/文件2
```

并排合并两个文件，每个文件以指定的分隔符分隔为单独的列。

```sh
paste -d 分隔符 路径/到/文件1 路径/到/文件2
```

将两个文件中的所有行，交替合并。

```sh
paste -d '\n' 路径/到/文件1 路径/到/文件2
```

## tr

转换或删除输入流中的字符。

把标准输入中的小写字母转为大写。

```sh
tr '[:lower:]' '[:upper:]' < names.txt
```

## sort

对文本文件的行进行排序。

以升序对文件进行排序。

```sh
sort 路径/到/文件
```

以降序对文件进行排序。

```sh
sort -r 路径/到/文件
```

以不区分大小写的方式对文件进行排序。

```sh
sort -f 路径/到/文件
```

用数字而不是字母顺序对文件进行排序。

```sh
sort -n 路径/到/文件
```

按每行的第 3 个字段对 `/etc/passwd` 进行数字排序，使用 “:” 作为字段分隔符。

```sh
sort -t : -k 3n /etc/passwd
```

## uniq

输出输入或文件中的唯一行。 因为它只检测相邻的重复行，所以需要先对它们进行排序。

仅显示每行一次。

```sh
sort 路径/到/文件 | uniq
```

仅显示唯一的行。

```sh
sort 路径/到/文件 | uniq -u
```

仅显示重复的行。

```sh
sort 路径/到/文件 | uniq -d
```

显示每行的出现次数及其内容。

```sh
sort 路径/到/文件 | uniq -c
```

显示每行的出现次数，并按出现次数从高到低排序。

```sh
sort 路径/到/文件 | uniq -c | sort -nr
```

## tee

把标准输入同时输出到屏幕和文件。

显示结果并追加到日志。

```sh
date | tee -a run.log
```

## split

把大文件切分为多个较小的文件。

每一万行生成一个以 part- 开头的文件。

```sh
split -l 10000 data.txt part-
```

## join

在两个已排序的文件中根据一个公共字段合并行。

根据第一个（默认）字段合并两个文件。

```sh
join 路径/到/文件1 路径/到/文件2
```

使用逗号（而不是空格）作为字段分隔符合并两个文件。

```sh
join -t ',' 路径/到/文件1 路径/到/文件2
```

将文件 1 的字段 3 与文件 2 的字段 1 合并。

```sh
join -1 3 -2 1 路径/到/文件1 路径/到/文件2
```

为文件 1 中的每行未配对的行生成一行。

```sh
join -a 1 路径/到/文件1 路径/到/文件2
```

从 `stdin` 合并一个文件。

```sh
cat 路径/到/文件1 | join - 路径/到/文件2
```

## rev

反转每行的字符顺序。

逐行逆序输出文本。

```sh
rev words.txt
```

## numfmt

在人类可读单位与数字之间转换。

以 IEC 单位显示字节数。

```sh
numfmt --to=iec-i --suffix=B 1048576
```

## iconv

转换文本的字符编码。

把 GB18030 文件转换为 UTF-8 新文件。

```sh
iconv -f GB18030 -t UTF-8 source.txt > utf8.txt
```

## jq

一个使用特定领域语言（DSL）的 JSON 处理器。

使用 `jq` 二进制执行特定的表达式（打印出彩色和格式化的 JSON 输出）。

```sh
jq '.' 路径/到/文件.json
```

执行特定的脚本。

```sh
cat 路径/到/文件.json | jq -f 路径/到/脚本.jq
```

传递特定的参数。

```sh
cat 路径/到/文件.json | jq --arg "name1" "value1" --arg "name2" "value2" ... '. + $ARGS.named'
```

通过来自多个文件的旧 JSON 对象创建新的 JSON 对象。

```sh
cat 路径/到/多个_json_文件_*.json | jq '{newKey1: .key1, newKey2: .key2.nestedKey, ...}'
```

打印特定的数组项。

```sh
cat 路径/到/文件.json | jq '.[索引1], .[索引2], ...'
```

## yq

一个轻量级且可移植的命令行 YAML 处理器。

以漂亮打印格式输出 YAML 文件（v4+）。

```sh
yq eval 路径/到/file.yaml
```

以漂亮打印格式输出 YAML 文件（v3）。

```sh
yq read 路径/到/file.yaml -C
```

输出仅包含数组的 YAML 文件中的第一个元素（v4+）。

```sh
yq eval '.[0]' 路径/到/file.yaml
```

输出仅包含数组的 YAML 文件中的第一个元素（v3）。

```sh
yq read 路径/到/file.yaml '[0]'
```

在文件中设置（或覆盖）键的值（v4+）。

```sh
yq eval '.键 = "值"' -i 路径/到/file.yaml
```

## shuf

随机打乱输入行或抽样。

从名单中随机显示三行。

```sh
shuf -n 3 names.txt
```

## seq

打印数字序列到标准输出。

从 1 到 10 的序列。

```sh
seq 10
```

从 5 开始，3 为步长，不超过 20 的序列。

```sh
seq 5 3 20
```

从 5 开始，3 为步长，不超过 20 的序列，并用空格作为分隔符。

```sh
seq -s " " 5 3 20
```

从 5 开始，3 为步长，不超过 20 的序列，并格式化为 4 位宽度，不足 4 位，前面补 0。

```sh
seq -f "%04g" 5 3 20
```

## printf

格式化并打印文本。

打印文本消息。

```sh
printf "%s\n" "文本"
```

以粗体蓝色打印整数。

```sh
printf "\e[1;34m%.3d\e[0m\n" 42
```

打印带有 Unicode 欧元符号的浮点数。

```sh
printf "\u20AC %.2f\n" 123.4
```

打印由环境变量组成的文本消息。

```sh
printf "var1: %s\tvar2: %s\n" "$VAR1" "$VAR2"
```

将格式化消息存储在变量中（不适用于 Zsh）。

```sh
printf -v 变量名 "这是 %s = %d年\n" "今" 2016
```

## echo

输出给定参数。

输出文本信息. 注意： 引号是可选的。

```sh
echo "Hello World"
```

输出带有环境变量的信息。

```sh
echo "My path is $PATH"
```

打印不带尾随换行符的信息。

```sh
echo -n "Hello World"
```

向文件添加信息。

```sh
echo "Hello World" >>file.txt
```

启用反斜杠转义的解释（特殊字符）。

```sh
echo -e "Column 1\tColumn 2"
```

## envsubst

将文本中的环境变量替换为对应值。

只替换模板中的 PORT 变量。

```sh
envsubst '${PORT}' < service.conf.in
```

译文与示例节选自 [tldr-pages 团队及贡献者](https://github.com/tldr-pages/tldr/tree/ab12845965343cfecb51bf2d4db03f3f1f1c75b9/pages.zh)，依照 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 许可整理。DevKit 按主题重编，简化了示例占位符，并补充了部分说明和用法。

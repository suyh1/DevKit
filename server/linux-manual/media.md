## ffmpeg

视频转换工具。

从视频中提取音频并保存为 MP3 格式。

```sh
ffmpeg -i 路径/到/video.mp4 -vn 路径/到/sound.mp3
```

将 FLAC 文件转码为红皮书 CD 格式（44100 Hz，16 位）。

```sh
ffmpeg -i 路径/到/input_audio.flac -ar 44100 -sample_fmt s16 路径/到/output_audio.wav
```

将视频保存为 GIF，设置高度为 1000 像素，帧率为 15。

```sh
ffmpeg -i 路径/到/video.mp4 -vf 'scale=-1:1000' -r 15 路径/到/output.gif
```

将编号图像（如 `frame_1.jpg`、`frame_2.jpg` 等）合成为视频或 GIF。

```sh
ffmpeg -f image2 -i 路径/到/frame_%d.jpg video.mpg
```

从给定的开始时间 mm:ss 到结束时间 mm2:ss2 裁剪视频（省略 `-to` 参数表示裁剪至末尾）。

```sh
ffmpeg -i 路径/到/input_video.mp4 -ss mm:ss -to mm2:ss2 -c copy 路径/到/output_video.mp4
```

## ffprobe

检查音视频容器、编码与流信息。

以 JSON 输出媒体文件的基本信息。

```sh
ffprobe -v quiet -show_format -show_streams -of json sample.mp4
```

## magick

创建，编辑，组合，转换不同格式的图片文件。 这个工具在 ImageMagick 7 以上版本中代替了原 `convert` 命令，如需在 7+ 版本中使用原命令，请查看 `magick convert`。 此命令也有关于其子命令的文件，例如：`mogrify`。

转换图片格式。

```sh
magick 路径/到/输入图片.png 路径/到/输出图片.jpg
```

改变图片大小，生成新的副本。

```sh
magick 路径/到/输入图片.jpg -resize 100x100 路径/到/输出图片.jpg
```

利用当前目录下的所有 JPEG 图片生成一个 GIF 动图。

```sh
magick *.jpg 路径/到/GIF文件.gif
```

生成棋盘格图片。

```sh
magick -size 640x480 pattern:checkerboard 路径/到/棋盘格图片.png
```

利用当前目录下的所有 JPEG 图片生成一个 PDF 文件。

```sh
magick *.jpg -adjoin 路径/到/PDF文件.pdf
```

## jpegoptim

优化 JPEG 图像。

优化一组 JPEG 图像，保留所有相关数据。

```sh
jpegoptim 图像1.jpeg 图像2.jpeg 图像3.jpeg ...
```

优化 JPEG 图像，剥离所有非必要数据。

```sh
jpegoptim -s 图像1.jpeg 图像2.jpeg 图像3.jpeg ...
```

强制输出图像为渐进式。

```sh
jpegoptim --all-progressive 图像1.jpeg 图像2.jpeg 图像3.jpeg ...
```

强制输出图像具有固定的最大文件大小。

```sh
jpegoptim -S 250k 图像1.jpeg 图像2.jpeg 图像3.jpeg ...
```

## pandoc

在 Markdown、HTML 等文档格式之间转换。

将 Markdown 转为独立 HTML 文件。

```sh
pandoc notes.md -s -o notes.html
```

## pdftotext

从含文本层的 PDF 中提取文字。

保留原页面布局，将结果写入新文件。

```sh
pdftotext -layout report.pdf report.txt
```

## pdfinfo

查看 PDF 的页数、页面尺寸和文档属性。

读取文档的概要信息。

```sh
pdfinfo report.pdf
```

## qpdf

多功能 PDF 转换软件。

从一个 PDF 文件中提取第 1-3 页、第 5 页和第 6-10 页，然后另存为一个新文件。

```sh
qpdf --empty --pages 路径/到/输入.pdf 1-3,5,6-10 -- 路径/到/输出.pdf
```

合并（连接）多个 PDF 文件的所有页面，并将结果保存为一个新 PDF。

```sh
qpdf --empty --pages 路径/到/文件1.pdf 文件2.pdf ... -- 路径/到/输出.pdf
```

合并（连接）多个 PDF 文件中指定的页面，并将结果保存为一个新 PDF。

```sh
qpdf --empty --pages 路径/到/文件1.pdf 1,6-8 路径/到/文件2.pdf 3,4,5 -- 路径/到/输出.pdf
```

将每组 `n` 页写入一个单独的输出文件，使用给定的文件名模式。

```sh
qpdf --split-pages=n 路径/到/输入.pdf 路径/到/输出_%d.pdf
```

旋转某些页面的 PDF 以给定角度。

```sh
qpdf --rotate=90:2,4,6 --rotate=180:7-8 路径/到/输入.pdf 路径/到/输出.pdf
```

## man

展示手册分页 (manual page)。

展示一条命令的使用手册分页。

```sh
man command
```

在浏览器中打开一条命令的使用手册分页 (`$BROWSER` 环境变量可以替换 `=browser_name`)。

```sh
man -Hbrowser_name command
```

从第七章节展示一条命令的使用手册分页。

```sh
man 7 command
```

列表展示一条命令的所有可用章节。

```sh
man -f command
```

展示搜索手册分页的路径。

```sh
man -w
```

## apropos

在 manpages 中搜索，例如查找一个新命令。

使用`regex`式搜索关键字。

```sh
apropos 正则表达式
```

搜索时不限制输出到终端宽度。

```sh
apropos -l 正则表达式
```

搜索与给定的所有表达式都匹配的页面。

```sh
apropos 正则表达式_1 -a 正则表达式_2 -a 正则表达式_3
```

译文与示例节选自 [tldr-pages 团队及贡献者](https://github.com/tldr-pages/tldr/tree/ab12845965343cfecb51bf2d4db03f3f1f1c75b9/pages.zh)，依照 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 许可整理。DevKit 按主题重编，简化了示例占位符，并补充了部分说明和用法。

## md5sum

计算 MD5 加密校验和。

计算一个或多个文件的 MD5 校验和。

```sh
md5sum 路径/到/文件1 路径/到/文件2 ...
```

计算并将 MD5 校验和列表保存到一个文件中。

```sh
md5sum 路径/到/文件1 路径/到/文件2 ... >路径/到/文件.md5
```

从 `stdin` 计算 MD5 校验和。

```sh
命令 | md5sum
```

读取包含 MD5 校验和和文件名的文件，并验证所有文件的校验和是否匹配。

```sh
md5sum -c 路径/到/文件.md5
```

仅在文件丢失或验证失败时显示消息。

```sh
md5sum -c --quiet 路径/到/文件.md5
```

## sha256sum

计算或校验文件的 SHA-256 摘要。

根据校验清单验证下载文件。

```sh
sha256sum -c SHA256SUMS
```

## sha512sum

计算文件的 SHA-512 摘要。

显示归档文件的校验值。

```sh
sha512sum archive.tar
```

## shasum

计算或检查加密 SHA 校验值。

计算一个或多个文件的 SHA1 校验值。

```sh
shasum 路径/到/文件1 路径/到/文件2 ...
```

使用指定算法计算一个或多个文件的 SHA 校验值。

```sh
shasum --algorithm 1 路径/到/文件1 路径/到/文件2 ...
```

从标准输入中获取并计算 SHA1 校验值。

```sh
命令 | shasum
```

计算并保存 SHA256 校验值列表到文件。

```sh
shasum --algorithm 256 路径/到/文件1 路径/到/文件2 ... >路径/到/文件.sha256
```

读取包含 SHA 校验值和文件名的文件，并验证所有文件是否具有匹配的校验值（算法将被自动检测）。

```sh
shasum -c 路径/到/文件
```

## cksum

计算文件的校验和及字节数。

显示数据文件的 CRC 校验信息。

```sh
cksum data.bin
```

## base32

将文件或标准输入编码到 Base32 或从 Base32 解码为标准输出。

编码一个文件。

```sh
base32 路径/到/文件
```

按特定宽度包装编码输出（“0”表示禁用包装）。

```sh
base32 -w 0 路径/到/文件
```

解码一个文件。

```sh
base32 -d 路径/到/文件
```

从标准输入编码。

```sh
某指令 | base32
```

将标准输入解码。

```sh
某指令 | base32 -d
```

## base64

将文件或标准输入编码到 Base64 或从 Base64 解码为标准输出。

编码一个文件。

```sh
base64 路径/到/文件
```

按特定宽度包装编码输出（“0”表示禁用包装）。

```sh
base64 -w 0 路径/到/文件
```

解码一个文件。

```sh
base64 -d 路径/到/文件
```

从标准输入编码。

```sh
某指令 | base64
```

将标准输入解码。

```sh
某指令 | base64 -d
```

## gpgv

验证 OpenPGP 签名。

验证签名文件。

```sh
gpgv path/to/file
```

使用分离式签名验证已签名的文件。

```sh
gpgv path/to/signature path/to/file
```

在 keyrings 列表中添加一个文件（一个导出的钥匙也算作一个 keyring）。

```sh
gpgv --keyring path/to/keyring_file path/to/signature path/to/file
```

## age

一个简单、现代、安全的文件加密工具。

生成一个可以用密码短语（passphrase）解密的加密文件。

```sh
age -p -o 路径/到/已加密文件 路径/到/未加密文件
```

用一个或多个公钥加密一个文件，这些公钥以字面形式输入。

```sh
age -r 公钥 -o 路径/到/已加密文件 路径/到/未加密文件
```

用收件人文件中指定的一个或多个公钥来加密一个文件。

```sh
age -R 路径/到/收件人文件 -o 路径/到/已加密文件 路径/到/未加密文件
```

用密码短语解密一个文件。

```sh
age -d -o 路径/到/已解密文件 路径/到/已加密文件
```

用私钥文件解密一个文件。

```sh
age -d -i 路径/到/私钥文件 -o 路径/到/已解密文件 路径/到/已加密文件
```

## uuidgen

生成通用唯一标识符。

生成随机 UUID。

```sh
uuidgen -r
```

译文与示例节选自 [tldr-pages 团队及贡献者](https://github.com/tldr-pages/tldr/tree/ab12845965343cfecb51bf2d4db03f3f1f1c75b9/pages.zh)，依照 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 许可整理。DevKit 按主题重编，简化了示例占位符，并补充了部分说明和用法。

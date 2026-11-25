## python

Python 语言解释器。

启动 REPL（交互式 shell）。

```sh
python
```

执行特定 Python 文件。

```sh
python 路径/到/文件.py
```

执行特定 Python 文件后进入 REPL。

```sh
python -i 路径/到/文件.py
```

执行 Python 表达式。

```sh
python -c "表达式"
```

运行特定模块的脚本。

```sh
python -m 模块 参数
```

## uv

一个快速的 Python 软件包和项目管理器。 此命令也有关于其子命令的文件，例如：`tool` 和 `python`。

在当前目录中创建一个新的 Python 项目。

```sh
uv init
```

在具有指定名称的目录中创建一个新的 Python 项目。

```sh
uv init 项目名称
```

向项目中添加一个新的软件包。

```sh
uv add 软件包
```

从项目中移除一个软件包。

```sh
uv remove 软件包
```

在项目的环境中运行一个脚本。

```sh
uv run 路径/到/脚本.py
```

## virtualenv

创建被隔离的的 Python 虚拟环境。

创建新环境。

```sh
virtualenv path/to/venv
```

自定义提示符。

```sh
virtualenv --prompt prompt_prefix path/to/venv
```

为虚拟环境使用不同的 Python 版本。

```sh
virtualenv -p path/to/pythonbin path/to/venv
```

启动（选择）环境。

```sh
source path/to/venv/bin/activate
```

停止环境。

```sh
deactivate
```

## conda

为任何编程语言准备的包、依赖和环境管理工具。 部分子命令（例如 `create`）有自己的文档。

创建新的环境，并将指定包安装入该环境。

```sh
conda create -n 环境_名称 python=3.9 matplotlib
```

列出所有环境。

```sh
conda info -e
```

激活某个环境。

```sh
conda activate 环境_名称
```

取消激活某个环境。

```sh
conda deactivate
```

删除一个环境（会移除所有的包）。

```sh
conda remove -n 环境_名称 --all
```

## pytest

发现并运行 Python 测试。

仅列出将执行的测试。

```sh
pytest --collect-only -q
```

## ruff

检查 Python 代码的风格和常见问题。

扫描当前项目。

```sh
ruff check .
```

## mypy

根据类型注解检查 Python 代码。

检查包目录下的类型。

```sh
mypy src/
```

## node

服务器后端 JavaScript 平台（Node.js）。

运行一个 JavaScript 文件。

```sh
node 路径/到/文件
```

开始一个 REPL 交互式解释器。

```sh
node
```

执行指定的文件，当导入的文件发生变化时重启进程（需要 Node.js 18.11+ 版本）。

```sh
node --watch 路径/到/文件
```

执行输入的 JavaScript 代码。

```sh
node -e "代码"
```

执行输入的 JavaScript 代码并显示结果，用于打印 node 的依赖版本。

```sh
node -p "process.versions"
```

## npm

JavaScript 和 Node.js 软件包管理器。 管理 Node.js 项目及其模块依赖项。 此命令也有关于其子命令的文件，例如：`install`, `run`。

使用默认值创建一个 `package.json` 文件（省略 `--yes` 来以交互方式执行）。

```sh
npm init -y
```

下载 `package.json` 中列出的所有依赖项软件包。

```sh
npm i
```

下载软件包的特定版本并将其添加到 `package.json` 中的依赖项列表中。

```sh
npm i 软件包名@版本号
```

下载软件包的最新版本并将其添加到 `package.json` 中的开发依赖项列表中。

```sh
npm i 软件包名 -D
```

下载软件包的最新版本并全局安装（用 `npm config set prefix` 设置安装位置）。

```sh
npm i 软件包名 -g
```

## pnpm

快速、节省磁盘空间的 Node.js 包管理器。 管理 Node.js 项目和其模块依赖。

创建 `package.json` 文件。

```sh
pnpm init
```

下载 `package.json` 中列出的所有依赖包。

```sh
pnpm i
```

下载指定版本的包并添加至 `package.json` 的依赖列表。

```sh
pnpm add 模块名@版本
```

下载包并添加至 `package.json` 的开发依赖列表。

```sh
pnpm add 模块名 -D
```

下载并全局安装包。

```sh
pnpm add 模块名 -g
```

## yarn

JavaScript 和 Node.js package manager 的一个替代。

全局安装一个模块。

```sh
yarn global add module_name
```

安装 `package.json` 中指定的依赖（`install` 命令是可选的 -- 你可以直接输入`yarn`）。

```sh
yarn install
```

安装一个模块并将其写入 `package.json` 中的依赖项（增加 `--dev` 来作为开发依赖写入）。

```sh
yarn add module_name@version
```

卸载一个模块并将其从 `package.json` 的依赖项中移除。

```sh
yarn remove module_name
```

交互式地创建一个 `package.json` 文件。

```sh
yarn init
```

## deno

一个安全的 JavaScript 和 TypeScript 运行时。

运行 JavaScript 或 TypeScript 文件。

```sh
deno run 路径/到/文件.ts
```

启动 REPL（交互式 shell）。

```sh
deno
```

运行文件并启用网络访问。

```sh
deno run --allow-net 路径/到/文件.ts
```

从 URL 运行文件。

```sh
deno run https://deno.land/std/examples/welcome.ts
```

从 URL 安装可执行脚本。

```sh
deno install https://deno.land/std/examples/colors.ts
```

## bun

JavaScript 运行时和工具箱。 包含打包工具、测试运行器和包管理器。

在当前文件夹创建新的 Bun 项目。

```sh
bun init
```

运行 JavaScript 文件或 `package.json` 脚本。

```sh
bun run path/to/file
```

运行单元测试。

```sh
bun test
```

下载并安装 `package.json` 中列为依赖项的包。

```sh
bun i
```

向 `package.json` 添加依赖。

```sh
bun a 模块名称
```

## go

管理 Go 源代码的工具。 此命令也有关于其子命令的文件，例如：`build`。

下载并安装由其路径指定的包。

```sh
go get 路径/到/包
```

编译并运行一个源文件（它必须包含一个 `main` 包）。

```sh
go run 文件.go
```

将源文件编译为当前命名的可执行文件。

```sh
go build -o 可执行文件 文件.go
```

编译当前目录中的包。

```sh
go build
```

执行当前包中的所有测试用例（文件必须以 `_test.go` 结尾）。

```sh
go test
```

## go build

编译 Go 源代码。

编译 'package main' 文件（输出为不带扩展名的文件名）。

```sh
go build 路径/到/main.go
```

编译并指定输出文件名。

```sh
go build -o 路径/到/二进制文件 路径/到/源文件.go
```

编译一个包。

```sh
go build -o 路径/到/二进制文件 路径/到/包
```

编译 main 包为可执行文件，并开启数据竞态检测。

```sh
go build -race -o 路径/到/可执行文件 路径/到/main/包
```

## go test

运行 Go 包的测试。

测试当前模块的所有子包。

```sh
go test ./...
```

## rustc

Rust 编译器。 Rust 项目通常使用 `cargo` 而不是直接调用 `rustc`。

编译二进制包（crate）。

```sh
rustc 路径/到/主文件.rs
```

编译时启用优化（`s` 表示针对二进制大小优化；`z` 含义相同但使用更多优化）。

```sh
rustc -C lto -C opt-level=0 路径/到/主文件.rs
```

编译时包含调试信息。

```sh
rustc -g 路径/到/主文件.rs
```

解释错误信息。

```sh
rustc --explain 错误码
```

编译时针对当前 CPU 架构启用特定优化。

```sh
rustc -C target-cpu=native 路径/到/主文件.rs
```

## rustup

安装、管理和更新 Rust 工具链。 一些子命令，如 `toolchain`、`target`、`update` 等有自己的使用文档。

为你的系统安装 nightly 工具链。

```sh
rustup install nightly
```

将默认工具链切换为 nightly 以便 `cargo` 和 `rustc` 命令使用它。

```sh
rustup default nightly
```

在当前项目中使用 nightly 工具链，但保持全局设置不变。

```sh
rustup override set nightly
```

更新所有工具链。

```sh
rustup update
```

列出已安装的工具链。

```sh
rustup show
```

## cargo

管理 Rust 项目及其模块依赖项（crates）。 此命令也有关于其子命令的文件，例如：`build`。

搜索包（crate）。

```sh
cargo search 搜索关键词
```

安装二进制包（crate）。

```sh
cargo install 包名
```

列出已安装的二进制包（crate）。

```sh
cargo install --list
```

在指定目录（或默认情况下在当前工作目录）中创建一个新的二进制或库 Rust 项目。

```sh
cargo init --bin 路径/到/目录
```

向当前目录的 `Cargo.toml` 添加一个依赖项。

```sh
cargo add 依赖项
```

## cargo build

编译本地软件包及其所有依赖项。

在本地路径中构建由 `Cargo.toml` 清单文件定义的一个或多个软件包。

```sh
cargo b
```

以 release 模式构建，并进行优化。

```sh
cargo b -r
```

要求 `Cargo.lock` 文件为最新版本。

```sh
cargo b --locked
```

构建工作区中的所有软件包。

```sh
cargo b --workspace
```

构建特定的软件包。

```sh
cargo b -p 软件包
```

## cargo test

执行 Rust 包的单元测试和集成测试。

仅运行包含特定字符串在其名称中的测试。

```sh
cargo t 测试名称
```

设置并行运行测试用例的数量。

```sh
cargo t -- --test-threads 数量
```

在 release 模式下测试构建，启用优化。

```sh
cargo t -r
```

测试工作区中的所有包。

```sh
cargo t --workspace
```

为特定包运行测试。

```sh
cargo t -p 包名
```

## cargo fmt

在 Rust 项目中对所有源文件运行 `rustfmt`。

格式化所有源文件。

```sh
cargo fmt
```

检查格式错误，不对文件进行写入操作。

```sh
cargo fmt --check
```

将参数传递给每个 rustfmt 调用。

```sh
cargo fmt -- rustfmt参数
```

## java

Java 程序启动器。

通过提供类名称运行一个含有 main 函数的 java `.class` 程序。

```sh
java 类名称
```

运行 Java 程序，并使用附加的第三方或用户定义类。

```sh
java -classpath 路径/到/类1:路径/到/类2:. 类名称
```

运行一个 `.jar` 程序。

```sh
java -jar 文件名.jar
```

运行一个 `.jar` 程序并且在端口 5005 等待调试器。

```sh
java -agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=*:5005 -jar 文件名.jar
```

显示帮助。

```sh
java -help
```

## javac

Java 程序编译器。

编译一个 `.java` 文件。

```sh
javac 文件名.java
```

编译多个 `.java` 文件。

```sh
javac 文件名1.java 文件名2.java 文件名3.java ...
```

编译当前目录内所有 `.java` 文件。

```sh
javac *.java
```

编译一个 `.java` 文件并将生成的 class 字节码文件放入一个指定目录。

```sh
javac -d 路径/到/目录 文件名.java
```

## jar

Java 应用程序 / 类库打包程序。

将当前目录中的所有文件递归归档到 `.jar` 文件中。

```sh
jar cf file.jar *
```

将 `.jar` / `.war` 文件解压缩到当前目录。

```sh
jar -xvf file.jar
```

列出 `.jar` / `.war` 文件内容。

```sh
jar tf path/to/file.jar
```

列出带有详细输出的 `.jar` / `.war` 文件内容。

```sh
jar tvf path/to/file.jar
```

## javadoc

从源代码以 HTML 格式生成 Java API 文档。

生成 Java 源代码的文档并将结果保存在文件夹中。

```sh
javadoc -d path/to/directory/ path/to/java_source_code
```

生成指定编码的文档。

```sh
javadoc -docencoding UTF-8 path/to/java_source_code
```

生成文档时，排除掉某些软件包。

```sh
javadoc -exclude package_list path/to/java_source_code
```

## mvn

Apache Maven：构建和管理基于 Java 的项目。

编译项目。

```sh
mvn compile
```

将编译后的代码打包成可分发格式，比如 `jar`。

```sh
mvn package
```

编译和打包，跳过单元测试。

```sh
mvn package -D skipTests
```

在本地 maven 存储库中安装构建的包（这也会调用 compile 和 package 命令）。

```sh
mvn install
```

从目标目录中删除构建工件，通常用来清理之前的编译结果。

```sh
mvn clean
```

译文与示例节选自 [tldr-pages 团队及贡献者](https://github.com/tldr-pages/tldr/tree/ab12845965343cfecb51bf2d4db03f3f1f1c75b9/pages.zh)，依照 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 许可整理。DevKit 按主题重编，简化了示例占位符，并补充了部分说明和用法。

## sqlite3

SQLite 3 的命令行接口，SQLite 是一个独立的、基于文件的嵌入式 SQL 引擎。

启动交互式 shell 并创建一个新数据库。

```sh
sqlite3
```

针对已有的数据库打开交互式 shell。

```sh
sqlite3 路径/到/数据库.sqlite3
```

对数据库执行一条 SQL 语句后退出。

```sh
sqlite3 路径/到/数据库.sqlite3 'SELECT * FROM 某张表;'
```

## psql

在终端中访问 PostgreSQL。

连接数据库并执行只读查询。

```sh
psql -d appdb -c 'SELECT current_database();'
```

## pg_dump

把 PostgreSQL 数据库导出为备份。

用自定义格式备份一个数据库。

```sh
pg_dump -Fc -f appdb.dump appdb
```

## pg_isready

检查 PostgreSQL 服务是否接受连接。

查询本机默认端口的状态。

```sh
pg_isready -h localhost -p 5432
```

## mysql

MySQL 命令行工具。

连接数据库。

```sh
mysql 数据库名
```

连接到数据库，系统将提示用户输入密码。

```sh
mysql -u 用户名 -p 数据库名
```

连接到另一台主机上的数据库。

```sh
mysql -h 数据库地址 数据库名
```

通过 Unix 套接字文件连接到数据库。

```sh
mysql -S 路径/到/socket.sock
```

执行脚本文件中的 SQL 语句。

```sh
mysql -e "source 脚本.sql" 数据库名
```

## mysqldump

将 MySQL 数据库中的结构和数据导出为 SQL。

提示输入密码并导出指定库。

```sh
mysqldump -u appuser -p appdb > appdb.sql
```

## redis-cli

与 Redis 服务进行交互。

检查本机服务是否响应。

```sh
redis-cli PING
```

## q

在 CSV 和 TSV 文件上执行类似 SQL 的查询。

指定分隔符为 ',' 来查询 CSV 文件。

```sh
q -d ',' "SELECT * from 路径/到/文件"
```

查询 TSV 文件。

```sh
q -t "SELECT * from 路径/到/文件"
```

查询带有表头行的文件。

```sh
q -d 分隔符 -H "SELECT * from 路径/到/文件"
```

从 `stdin` 读取数据；查询中的 '-' 代表来自 `stdin` 的数据。

```sh
输出 | q "select * from -"
```

在列 `c1` 上连接两个文件（在例子中别名为 `f1` 和 `f2`）。

```sh
q "SELECT * FROM 路径/到/文件1 f1 JOIN 路径/到/文件2 f2 ON (f1.c1 = f2.c1)"
```

译文与示例节选自 [tldr-pages 团队及贡献者](https://github.com/tldr-pages/tldr/tree/ab12845965343cfecb51bf2d4db03f3f1f1c75b9/pages.zh)，依照 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 许可整理。DevKit 按主题重编，简化了示例占位符，并补充了部分说明和用法。

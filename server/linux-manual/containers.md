## docker

管理 Docker 容器和镜像。 此命令也有关于其子命令的文件，例如：`run`。

列出所有 Docker 容器（包括停止的容器）。

```sh
docker ps -a
```

透过镜像启动容器，并为容器命名。

```sh
docker run --name 容器名称 镜像
```

启动或停止现有容器。

```sh
docker container start 容器名称
```

从 Docker registry 中拉取镜像。

```sh
docker pull 镜像
```

显示已下载的镜像清单。

```sh
docker images
```

## docker build

从 Dockerfile 与构建上下文生成镜像。

在本地项目目录构建并命名镜像。

```sh
docker build -t demo:local .
```

## docker images

列出本机 Docker 镜像。

显示本地镜像及标签。

```sh
docker images
```

## docker ps

查看 Docker 容器的运行状态。

列出全部容器，包括已停止的容器。

```sh
docker ps -a
```

## docker exec

在已运行的容器内执行程序。

读取容器内的工作目录。

```sh
docker exec web pwd
```

## docker logs

读取容器的标准输出和错误日志。

查看指定容器最近一百行日志。

```sh
docker logs --tail 100 web
```

## docker inspect

读取容器或镜像的配置元数据。

查看容器的运行状态。

```sh
docker inspect --format '{{.State.Status}}' web
```

## docker stats

查看容器的资源使用情况。

显示一组 CPU 和内存统计后退出。

```sh
docker stats --no-stream
```

## docker volume

管理 Docker 数据卷。

列出本机数据卷。

```sh
docker volume ls
```

## docker compose

运行并管理多个 Docker 容器应用。

列出所有正在运行的容器。

```sh
docker compose ps
```

根据当前目录下的 `docker-compose.yml` 文件，创建并后台启动所有的容器。

```sh
docker compose up -d
```

启动所有容器。如果必要，重新构建。

```sh
docker compose up --build
```

指定一个项目名称和特定 compose 文件，启动所有容器。

```sh
docker compose -p 项目_名称 -f 路径/到/文件 up
```

停止所有运行中的容器。

```sh
docker compose stop
```

## docker compose up

启动并运行 Compose 文件中定义的 Docker 服务。

启动 docker-compose 文件中定义的所有服务。

```sh
docker compose up
```

在后台启动服务（分离模式）。

```sh
docker compose up -d
```

启动服务前重新构建镜像。

```sh
docker compose up --build
```

仅启动指定服务。

```sh
docker compose up 服务1 服务2 ...
```

使用自定义 compose 文件启动服务。

```sh
docker compose -f 路径/到/配置文件 up
```

## docker compose logs

查看 Docker Compose 应用中各容器的日志输出。

查看所有服务的日志。

```sh
docker compose logs
```

查看指定服务的日志。

```sh
docker compose logs 服务名
```

查看日志并持续跟踪新输出（类似 `tail --follow`）。

```sh
docker compose logs -f
```

查看带时间戳的日志。

```sh
docker compose logs -t
```

仅查看每个容器最近 `n` 行日志。

```sh
docker compose logs -n n
```

## kubectl

通过当前上下文访问 Kubernetes 集群。

查看当前使用的上下文名称。

```sh
kubectl config current-context
```

## kubectl get

读取当前 Kubernetes 上下文中的资源。

列出默认命名空间中的 Pod。

```sh
kubectl get pods
```

## kubectl describe

查看 Kubernetes 资源的详情与近期事件。

检查指定 Pod 的调度和启动状态。

```sh
kubectl describe pod web
```

## kubectl logs

读取 Kubernetes 容器日志。

查看指定 Pod 的最近五十行日志。

```sh
kubectl logs --tail=50 web
```

## helm

用 Chart 管理 Kubernetes 应用。

查看当前命名空间中的发布记录。

```sh
helm list
```

译文与示例节选自 [tldr-pages 团队及贡献者](https://github.com/tldr-pages/tldr/tree/ab12845965343cfecb51bf2d4db03f3f1f1c75b9/pages.zh)，依照 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 许可整理。DevKit 按主题重编，简化了示例占位符，并补充了部分说明和用法。

# JSON 与 Java / TypeScript 类型转换（v1.3）

工具库保留两个入口，总工具数仍为 38 个。

## JSON 转类型

原来的“JSON 转 Java”和“JSON 转 TypeScript”合并为 **JSON 转类型**。在“目标语言”选择 Java 或 TypeScript；切换时保留输入、根类型名与各语言配置。

- Java：POJO / Record、无依赖 / Jackson 字段映射。结果导出为根类型名对应的 `.java` 文件。
- TypeScript：interface / type、仅类型 / 类型加对象初始化。结果导出为 `.ts` 文件。
- 沿用原有全样本推断、数组对象字段合并、Java 数值范围与 JSON 数字原文保留能力。
- 切换语言后，旧结果标记待更新；点击处理生成对应语言结果。

## 类型转 JSON

选择输入语言，粘贴 Java 实体类或 TypeScript 类型定义，点击处理。根类型名留空时选择文件中首个类型，也可显式指定 `User` 或 Java 嵌套类型名 `User.Profile`。输入有多个依赖类型时请一起粘贴。

这是按声明类型生成的 JSON 示例，不会还原真实业务数据；不运行源码、初始值、构造器、方法或 import。输出可结构预览、复制、导出 `.json`，也可发送到 JSON 格式化、JSON Schema 或 JSON 转类型继续处理。

### TypeScript

支持顶层 `interface`、`type`、枚举，字段与引号字段名、可选字段、内联对象、数组、命名/普通元组、字面量及联合类型、本地 interface 继承与对象交叉类型、带具体参数或默认参数的本地泛型。

支持 `Array<T>`、`ReadonlyArray<T>`、`Record<K,V>`、`Map<K,V>`、`Readonly<T>`、`Required<T>` 等常见容器。Record 的直接字面量联合键生成各个键，其他通用映射生成一个示例键。方法签名跳过，索引签名生成 `key` 示例字段。

Readonly / Required 在此用于展开内部类型，不实现完整 TypeScript 类型运算；“忽略可选字段”按内部原始字段声明处理。

```ts
export interface User {
  id: number;
  name: string;
  role: 'admin' | 'user';
  tags: string[];
  profile: { city: string };
  nickname?: string;
}
```

默认输出：

```json
{
  "id": 0,
  "name": "",
  "role": "admin",
  "tags": [""],
  "profile": { "city": "" },
  "nickname": ""
}
```

可选字段可以选择忽略。条件类型、映射类型、keyof、复杂类型计算、函数类型、namespace、需要执行表达式的枚举值和未提供定义的外部类型会报错，请先简化为具体字段类型。接口方法不转为 JSON 字段。`never`、`symbol` 等没有 JSON 对应值的类型不支持。

### Java

支持普通类、Record、枚举、字段数组、集合/Map、本地父类、内部类/Record、泛型类型引用、泛型通配符及 Record 变长参数。

```java
import java.util.List;

public class User {
    private Long id;
    private String name;
    private List<Profile> profiles;

    public static class Profile {
        private String city;
    }
}
```

默认输出：

```json
{
  "id": 0,
  "name": "",
  "profiles": [{ "city": "" }]
}
```

字段上的 `@JsonProperty("name")` 或 `@JsonProperty(value="name")` 用于 JSON 键名；`@JsonIgnore`、static、transient 字段跳过。不调用 getter，不推断 Lombok 自动生成的方法，不实现 Jackson 的完整序列化配置（如自定义命名策略、模块、JsonFormat、JsonInclude 或 getter 注解）。字段初始值不参与示例推断。

未提供定义的外部实体类会报错。泛型根类型需要带默认参数，或通过具体类型的别名/具体字段引用提供参数；Java 可在包含具体泛型字段的包装类上生成示例。Java 类型使用本地声明名，多个同名内部类按所在类作用域解析。

## 示例值与限制

| 类型 | 示例规则 |
| --- | --- |
| 字符串 / Java String、char | 空字符串 |
| 数字 / Java 基本数值、包装类型、BigInteger、BigDecimal | `0` |
| 布尔值 | `false` |
| 字面量 / 枚举 | 首个可用值；联合类型优先选非 null 分支 |
| 数组 / 集合 | 可设 0–5 个元素，默认 1；元组保留声明长度 |
| 日期类型 | 固定示例日期 2026-01-01，Date/Instant 使用 UTC ISO，LocalDateTime 不带时区 |
| any、unknown、null、undefined、Object、Void | `null` |
| TypeScript bigint | 字符串 `"0"`（JSON 无 bigint 类型） |
| 循环对象引用 | `null`，不无限展开；循环继承报错 |

输入最多 200,000 字符、500 个类型，示例最多 10,000 节点与 60 层。Worker 沿用 10 秒超时和主动取消。类型解析器在本地按需加载，使用 [Babel parser](https://babeljs.io/docs/babel-parser) 和 [java-parser](https://github.com/jhipster/prettier-java/tree/main/packages/java-parser)，无需在用户机器安装 JDK 或 TypeScript 编译器。

## 旧数据迁移

旧工作区中的 `json-java` / `json-ts` 自动转为 `json-code` 任务，保留 Java/TS 语言、根类型、POJO/Record 或 interface/type、注解和对象输出配置，以及原输入输出。恢复后仍标记为待更新。

旧启动入口和收藏迁移到合并工具，重复收藏合并。旧工具 ID 保留转换函数兼容性，不再作为两个独立入口展示。

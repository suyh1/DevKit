# JSON 结构差异与批量 Mock

## JSON 结构差异

在“文本与匹配 → 文本与 JSON 差异”中选择“JSON 结构”，左右填写原始/修改后 JSON，点击“对比结构”。示例按钮同时填写两侧示例，可交换内容。

结果按 JSON 字段路径列出新增、删除、修改、移动，点击路径可复制；对象键顺序和字符串转义的等价形式忽略。数字保留原始 token：大整数不经过 Number 舍入，`1` 和 `1.0` 视为不同表示。重复对象键拒绝比较，避免静默采用最后一个值。

数组默认按位置比较。填写“对象数组标识字段”（例如 `id`）后，纯对象数组按该字段匹配并显示位置移动；每个对象都必须有唯一字符串/数字标识，缺失或重复报错。该设置作用于两侧遍历到的纯对象数组；含标量/混合类型的数组仍按位置。数字标识同样按原始表示匹配。

每侧最多 300,000 字符、8,000 节点、100 层。预览前 500 项，源码和 JSON 导出保留完整差异。保留文本逐行模式及 unified diff 导出；两种模式导出的格式不同。

参考 [jsondiffpatch 的数组标识设计](https://github.com/benjamine/jsondiffpatch/blob/master/docs/arrays.md)（MIT），实际比较复用 DevKit 的保真 JSON 结构，不引入将数字转为 JS Number 的对象比较。

## 批量 Mock 数据

在“结构化数据 → 批量 Mock 数据”填写 JSON 示例或切换“Schema 子集”，点击示例查看对应格式。设置记录数量（1–1,000）、随机种子和 JSON/CSV 输出。全部本地 Worker 执行，支持取消；在同一版本、来源、参数、规则与种子下结果可复现，不依赖当前日期。依赖版本升级可能改变样本序列。

示例模式按字段结构生成新值，字符串 `name/姓名/用户名`、email/邮箱、phone/mobile/电话/手机、city/城市使用对应生成器；其他字符串生成单词，数字生成安全整数，布尔随机，null 保留。示例数组取首项作为记录模板；嵌套非空数组生成一个元素，空数组保持空。生成的是测试样本，不能还原真实数据。

字段规则为 JSON 对象，点分路径匹配字段，`[]` 表示数组元素。例如：

```json
{
  "id": "sequence",
  "name": "name",
  "profile.city": "city",
  "age": { "kind": "integer", "min": 18, "max": 65 },
  "role": { "kind": "pick", "values": ["管理员", "访客"] },
  "tags[]": "word"
}
```

支持 `name/email/phone/city/address/uuid/date/word/integer/number/boolean/sequence/pick`。字段规则优先于示例或 Schema，是显式覆盖；未匹配路径会报错，不静默忽略拼写错误。含点号或方括号的原始字段名不提供转义路径语法。`sequence` 按记录编号从 1 递增；日期在固定 2020–2030 范围内生成。数据来自 Faker 中文 locale，具体格式以对应生成器为准。

Schema 生成支持单个 `type`（object/array/string/integer/number/boolean/null）、properties/items、required、布尔 additionalProperties、minimum/maximum、minLength/maxLength、minItems/maxItems、const/enum，以及 email/uuid/date/date-time/uri format；忽略 title/description/examples/default 等说明字段。对象输出全部已定义属性；required 必须指向已定义属性，不额外生成未定义属性。const/enum 可与 type 联用，暂不支持叠加其他生成约束。规则覆盖可以改变 Schema 约束下的值，因此此工具不是完整 Schema 校验器或任意 Schema 满足性求解器。

不支持 `$ref`、组合 Schema、pattern 等关键字，遇到会明确报错；不联网解析引用。数组长度范围为 0–50，生成最小所需数量；字符串长度范围为 0–1,000，format 与显式长度不兼容时报错。输入数字超出 JS 安全范围会报错，需改成字符串。

输入最多 300,000 字符/8,000 节点，规则最多 30,000 字符，种子最多 200 字符；输出生成最多 100,000 节点、20 层和 4,000,000 字符，内部提前限制紧凑记录总量以控制内存。CSV 要求生成对象记录，嵌套值作为 JSON 单元格，并沿用现有公式转义。

生成器使用按需加载的 [Faker](https://github.com/faker-js/faker) 中文 locale；许可证为 [MIT](faker-license.txt)，原始许可随文档分发。只在首次运行 Mock 时加载对应解析/生成模块，不使用 CDN。

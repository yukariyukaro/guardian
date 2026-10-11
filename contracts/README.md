# Guardian API 契约入口

[openapi.yaml](openapi.yaml) 是路径、字段、DTO、枚举、查询、分页、错误、headers 与示例的唯一事实源。直接读取相关 operation/schema，不在说明文档、Mock 或代码维护第二份 API 定义；契约声明不表示路由已经实现。

- 设计与兼容流程：[API 设计规范](../docs/API设计规范.md)。
- 校验与交付：[测试与质量规范](../docs/测试与质量规范.md)；可用命令从当前 `package.json` 查阅。
- 所有 examples 是完全虚构数据，保留示例域名不作为真实证据。公开契约不得包含数据库内部结构、生产请求、真实材料、身份、密钥或私有 URL。
- OpenAPI 变更先评审、版本化、校验与兼容检查，再生成类型、Mock 和实现；使用支持 OpenAPI 3.1/JSON Schema 2020-12 的工具。生成类型不替代响应、语义、权限与隐私测试。

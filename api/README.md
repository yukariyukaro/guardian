# Guardian 私有 API

Fastify + TypeScript + PostgreSQL / Drizzle。公开 API 遵循 `../contracts/openapi.yaml` 的 OpenAPI 3.1 / `0.1.0`；仅实现公共读取，不提供管理发布、投稿、上传或自动审核能力。后端、数据库结构和运营配置不得复制到公开前端仓库。

## 无数据库本地开发

在 `api/` 执行已有 pnpm 脚本：

```sh
pnpm dev
pnpm typecheck
pnpm test
pnpm openapi:check
pnpm build
```

默认开发 adapter 为 `mock`，只使用完全虚构、保留示例域名的契约 fixtures。生产拒绝 mock。所有真实 API 失败均不可静默回退 mock。

## 显式数据库操作

先由获准人工准备隔离的 PostgreSQL 数据库和私有环境中的 `DATABASE_URL`，不将连接串提交到 Git、打印到日志或传到浏览器。本项目脚本不安装数据库、启动系统服务、创建数据库或创建角色。

```sh
pnpm db:migrate
pnpm db:bootstrap
NODE_ENV=development pnpm db:synthetic-seed
DATA_ADAPTER=postgres pnpm dev
```

以上脚本均已接入 `api/package.json`。运行时 `DATABASE_URL` 使用只读公开账号；迁移和 seed 使用独立维护账号。缺失连接配置时所有 PostgreSQL 读取与 readiness 返回安全 503，不回退虚构数据。

前端实际 API 联调可在第二个终端设置 `VITE_API_MODE=real` 后启动 `@guardian/web`；Vite 仅在开发态将 `/api/v1/public` 同源代理到 loopback `3001`。浏览器只访问公开 API，不接收数据库配置。生产需单独配置同源网关，不复用开发代理。

- `db:migrate` 是明确的维护/发布步骤，使用 Drizzle migration journal，并用 advisory lock 串行执行。已应用的迁移不可改写。API 启动、repository 构造或模块 import **不运行迁移或 seed**。
- `db:bootstrap` 仅用于非生产开发环境：应用已跟踪迁移并检查公开读 repository 已就绪，不自动生成数据库、账号、地区或内容。
- `db:synthetic-seed` 必须显式设置 `NODE_ENV=development|test`，production / 未知环境拒绝；只接受 canonical 虚构 fixture 图和保留示例域名。
- seed 只使用 `INSERT ... ON CONFLICT DO NOTHING`，不会覆盖现有内容或发布决定，不提供 reset、delete、truncate、drop。不会存储 fixture 内部身份/审核笔记，不伪造人工审核人或批准记录。重复执行保留现有记录。
- 生产只允许审核过的 migration 步骤，**不得使用虚构 seed**。安全枚举展示字典和版本取自共享契约；地区不是 seed 字典，始终从当前公开机构实时读取。

## Repository 的公开边界

`PostgresArchiveRepository` 接受注入的 pg Pool，domain 类型从 `archive.ts` / `institution.ts` 导入，不把持久层实体作为 HTTP DTO。

- 所有主记录和关联记录要求 `PUBLISHED`；隐藏、草稿、撤回详情不可见。嵌套来源/时间线先检查公开父机构。
- institution slug 保持公开投影主键；source / event 使用独立 `src-*` / `evt-*` public key，关联表也使用这些 key，无内部 UUID 公开投影。
- 数据库负责过滤、count、稳定排序和有界分页；关键词是字面子串，`%`、`_`、反斜线不会成为 LIKE 通配表达式。未知日期始终 NULLS LAST，同值按公开 key 排序。
- 每次读取使用 `REPEATABLE READ READ ONLY` 事务，同一 client / 同一快照包含 count、父机构和关系水合。client 在 BEGIN 前已纳入 finally 释放；rollback 失败会丢弃 client。
- `source_count` 只计当前公开关联来源；source 只返回公开机构 slug。非待核实事件失去所有公开支撑后移除；`linked` 必须包含可见 statement 来源。metadata 地区仅来自公开机构。
- 显式 DTO 白名单并通过契约验证。projection 缺陷返回安全 500；未知驱动/依赖异常返回安全 503，不返回 SQL、URL、输入值或驱动原文。无 mock 回退。
- Pool 连接超时 2 秒、查询/statement timeout 5 秒、最多 5 个连接；close 幂等。部署还须由人工配置连接数、数据库私网、只读账号和最小权限。

### 迁移与旧数据

`0000` 保持不变。`0001` 增加完整公开投影字段、来源、事件及可见关联表；机构新增字段为 nullable、visibility 默认 DRAFT，旧行不会被伪装成已审核内容。后续增量迁移补充契约 enum / risk-tag subset CHECK。公开内容完整性由 CHECK 和显式 mapper 共同验证，不允许通过给缺失审核信息填假值来发布。

回滚应用时优先回滚服务版本并保留扩展列/表；脚本没有破坏性 down migration。人工审核与合法回填完成后才能另行规划 contract/cleanup migration，不能重写已经部署的迁移。

## 独立真实 PostgreSQL integration

普通 `pnpm test` 不会启动或访问数据库。真实集成入口独立执行：

```sh
pnpm test:integration
```

仅在获准人工新建、明确批准且只含完全虚构数据的一次性本地 PostgreSQL 实例/数据库运行；禁止生产、共享 staging、业务库和已有真实数据的库。全部 integration（含 readonly / HTTP）在创建 Pool/App、连接、迁移或任何业务读取之前统一验证以下显式配置：

- `NODE_ENV=test` 必须精确设置；未设置、development、production 或未知值均拒绝。
- `GUARDIAN_TEST_RUN_ID`：本次一次性 run 的随机 32 位小写十六进制标识，不复用历史 run。
- `GUARDIAN_TEST_WORKER_ID`：规范十进制 worker 编号 `0` 到 `9999`，各独立并行 worker 使用不同数据库。同一 run/worker 内维护、readonly 与 HTTP suite 可以共享同一合成测试库。
- `GUARDIAN_TEST_TARGET_APPROVAL=synthetic-disposable:<run ID>`：由授权人工确认目标是本次新建的一次性合成库后注入，必须绑定当前 run。它不是自动检测/授权真实内容的替代品。
- 数据库名称必须精确为 `guardian_test_<run ID>_w<worker ID>`，只包含 `test` 子串不够。URL 必须为 `postgres:` / `postgresql:`，使用字面 loopback `127.0.0.1` 或 `[::1]`，显式合法端口、用户名和密码；不接受 DNS localhost、尾点、远程/私网目标、query（包括 pg host/database/options 覆盖）、fragment、空白或反斜线。
- `GUARDIAN_TEST_DATABASE_URL`：本次库的维护账号，可迁移及插入完全虚构数据。**不回退** `TEST_DATABASE_URL` 或普通 `DATABASE_URL`。
- `GUARDIAN_TEST_READONLY_DATABASE_URL`：必须与维护 URL 的 host/port/数据库一致，可以使用不同账号；非 superuser、不可建库/建角色，仅 `public_content` schema USAGE、表 SELECT，无 `internal_content` 权限和写权限。账号、GRANT、凭据由获准人工创建，测试不自动创建角色。

人工在获准一次性环境中准备迁移、只读 GRANT 和 canonical 虚构 seed（HTTP suite 依赖该图）；测试不会自动创建/销毁数据库或改用其他目标。run 结束后由人工销毁对应库，禁止复用和接入共享 staging。URL 结构检查不能证明本地端口没有转发到业务库，也不能证明库内无真实数据，仍须人工确认实例及数据隔离。

缺少或不符合任一配置，该检查明确 **FAIL / UNEXECUTED**，不会 skip 后冒充通过；拒绝消息不回显 URL、凭据或 run。纯函数允许/拒绝回归包含在普通 `pnpm test` 中，使用合成 URL，不读取真实环境或连接数据库。

覆盖 migration 幂等、公开 DTO 契约、分页/过滤/字面关键词、稳定/null 排序、主记录与关联撤回、事件来源支撑、实时地区/计数、同快照和 READ ONLY，以及运行时账号在显式 READ WRITE 中仍被 GRANT 拒绝写入、内部 drafts 不可读。每次使用随机前缀虚构图；结束时只隐藏该次测试自己的 key，保留历史，不重置或删除数据。真正数据库检查应在人工指定环境执行；Mock、SQL 文件生成和 typecheck 都不证明实库测试通过。

## 验证与发布门禁

数据库、公开投影、权限和隐私改动须由人工专项 review。合并前执行 API typecheck / unit / OpenAPI / build、独立实库迁移与只读权限测试以及适用的安全检查。生产部署、真实内容录入、审核批准、备份恢复和 commit/push 不由这些脚本自动执行。

### 本轮执行状态（2026-10-11）

- 公共读取 7 个 GET 全部实现，OpenAPI 0.1.0 未变；43 个 canonical examples 和 7 个真实注入响应通过校验。
- 全仓 `pnpm check` 通过，含前端 14 项和后端 68 项测试、类型、前端 lint、构建及生产前端隐私扫描。后端独立 ESLint 尚未配置，不以类型检查冒充 lint。
- 在独立 PostgreSQL 16 测试实例应用 0000/0001/0002、虚构 insert-only seed、迁移幂等检查；10 项真实数据库集成全部通过，包含 7 GET HTTP、事务/关系过滤、只读 GRANT 与私有草稿不可读。没有修改既有数据库或复制生产数据。
- Playwright CLI 验证前端 real adapter 的首页别名搜索、列表、详情、时间线和来源，实际 HTTP 200；原 Mock Chrome E2E 8 项通过。
- 公共请求 ID 由服务端随机生成；请求预算不保留用户身份；未知参数名和输入不会回显。
- `research/source-candidates.json` 是 Tavily 搜索得到的官方来源索引，仅私有待人工审核，不进入 fixtures/seed/公开 API；没有下载原始材料或导入真实机构档案。
- 尚未实现管理认证/写入/审核发布、更正表单接收、备份恢复演练和生产部署；不宣称完整 P0 或生产就绪。开发真实数据库配置仍须私有注入。


# OpenH3 命名与兼容性边界

OpenH3 使用 OpenH3 作为唯一的产品名称。新的安装包、窗口标题、应用身份、后端二进制、资源目录、更新仓库和 CLI 帮助均使用 OpenH3 名称。

## 旧标识的保留范围

以下标识不是产品展示名称，而是已有用户数据或线协议的一部分，不能在没有迁移器的情况下直接重命名：

- `AIONUI_*` 环境变量：旧脚本和已安装的 Agent 仍会读取它们。OpenH3 会优先读取 `OPENH3_*`，并继续接受旧变量。
- `aionui://` 深链、`aionui-session` Cookie、`x-aionui-*` 请求头：旧客户端和浏览器会话依赖这些协议值。
- `aionui.db`、`.aionui`、旧 `AionUi` 用户目录和 `bundled-aioncore`：这些路径可能包含数据库中的绝对路径，升级时保持原路径可读，避免技能、工作区和媒体引用失效。
- `aionui.dir`、内置技能/MCP 的历史 ID 和 `aion-extension.json`：它们是持久化键或扩展契约。新代码写入 OpenH3 记录时同步写旧键，读取时 canonical 优先、legacy 回退。
- `AIONCORE_LISTENING` / `AIONCORE_READY`：后端启动握手的线协议。OpenH3 使用新的解析器命名，但继续发送和接收旧 marker，确保旧桌面可以启动新后端。
- 上游依赖、版权归属和 upstream 文档中的 `AionUi` / `AionCore`：这些是来源或法律信息，不应伪造成 OpenH3 自有项目。

## 迁移规则

1. 新配置优先写入 OpenH3 名称，并在需要兼容旧客户端的地方双写旧键。
2. 读取持久化数据时先读 OpenH3 键；不存在时回退到旧键，不删除旧文件。
3. 新二进制为 `openh3-core`，`aioncore` 仅作为兼容入口保留；新资源目录为 `bundled-openh3-core`，旧目录继续被探测。
4. 任何删除旧标识的改动都必须同时提供一次性数据迁移、回滚路径和覆盖旧版本的集成测试。

这样可以做到“新版本不再展示旧品牌”，同时不破坏旧版本留下的数据库、会话、技能、扩展和脚本。

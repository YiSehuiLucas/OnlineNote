# OnlineNote

个人自用的在线笔记软件。浏览器访问，Markdown 原地渲染编辑（类 Typora：输入即渲染），笔记以真实文件目录树组织，支持登录与注册（默认最多 5 个账号）。

## 功能特性

- ✅ **原地渲染编辑（类 Typora）**：直接在渲染效果上书写，输入即渲染——`# ` 变标题、`- ` 出现圆点、`1. ` 出现编号、`---` 变成分隔线、`` ` `` 变为行内代码、``` ``` 打开多行代码块；编辑当前行时显示原始语法标记，离开后自动隐藏
- ✅ **方向键光标导航**：↑↓ 跨块上下移动（保持列位置，代码块内逐行移动、进出代码块），←→ 在块边界正确切换（进入标题/列表项时落到正文开头）
- ✅ **编辑体验**：Enter 换段、列表自动续项（有序列表自动续号）、空列表项回车退出列表、块边界退格/删除合并、`Ctrl+Z` 撤销、`Ctrl+S` 保存、中文输入法无干扰
- ✅ **Markdown 语法（当前支持）**：标题（`#`~`######`）、无序列表（`- `）、有序列表（`1. `）、分隔线（`---`）、行内代码（`` ` ``）、围栏代码块（``` ```）
- ✅ 文件目录树：SVG 图标、新建 / 重命名 / 删除笔记与文件夹（右键菜单）
- ✅ 用户登录 / 注册，注册人数上限默认 5（`auth.max_users` 可配置）
- ✅ **用户笔记完全隔离**：每个账号拥有独立的笔记目录（`data/notes/<用户名>/`），互不可见、互不可读写；删除账号时其笔记目录自动归档为隐藏目录
- ✅ **夜间主题**一键切换，自动记忆
- ✅ 笔记即文件：`data/notes/<用户名>/` 下的 `.md` 文件可直接备份、迁移、离线查看
- ✅ nginx 反向代理部署（附 nginx 配置与 systemd 服务单元）

## 技术栈

- **后端**：Go 1.25+ / Gin / SQLite（modernc 纯 Go 驱动，免 CGO，可交叉编译）/ bcrypt / HMAC Cookie 会话
- **前端**：原生 HTML/CSS/JS 静态页面（零构建），内置轻量 Markdown 引擎（`md.js`：行级解析；`app.js`：原地渲染编辑器）
- **部署**：nginx 反向代理 + systemd

## 目录结构

```
OnlineNote/
├── cmd/note/            主程序入口
├── cmd/notectl/         管理命令（初始化数据库、添加用户）
├── internal/            后端实现（config/model/store/service/session/middleware/handler/server）
├── web/                 前端静态页面（index.html / style.css / app.js / md.js）
├── doc/设计方案.md       设计文档
├── doc/部署说明.md       部署指南
├── configs/config.yaml  配置示例
├── deploy/              nginx.conf 与 systemd 单元
└── data/                运行时数据（笔记文件 + SQLite，已 gitignore）
```

## 快速开始（本地开发）

```bash
# 1. 拉取依赖（需要网络）
go mod tidy

# 2. 编译
go build -o bin/note ./cmd/note
go build -o bin/notectl ./cmd/notectl

# 3. 初始化数据库（在 data/ 下生成 note.db 与笔记根目录）
./bin/notectl -config configs/config.yaml db init

# 4.（可选）预置管理员账号（同样计入 5 人名额）
./bin/notectl -config configs/config.yaml user add -username admin -password 你的密码

# 5. 启动（开发模式下 Go 直接托管 web/ 静态页面）
./bin/note -config configs/config.yaml

# 6. 浏览器打开 http://127.0.0.1:8080
#    直接注册新账号（最多 5 人）或使用预置账号登录
```

> Windows 下将 `./bin/note` 换成 `bin\note.exe` 即可，其余命令相同。

`notectl` 其他命令：

```bash
./bin/notectl -config configs/config.yaml user list   # 查看已有账号与剩余名额
```

## 配置说明（configs/config.yaml）

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `server.addr` | `127.0.0.1:8080` | 监听地址（生产环境仅本机，由 nginx 对外） |
| `server.static` | `./web` | 前端静态目录（目录不存在时纯 API 模式） |
| `auth.max_users` | `5` | 注册人数上限（含预置账号） |
| `auth.session_secret` | `change-me` | 会话签名密钥，**部署时务必修改** |
| `auth.session_max_age_hours` | `168` | 会话有效期（小时） |
| `storage.root` | `./data/notes` | 笔记根目录 |
| `database.path` | `./data/note.db` | SQLite 数据库文件 |

## 生产部署

完整的部署流程（编译 → 上传 → systemd → nginx → 验证）见 [doc/部署说明.md](doc/部署说明.md)，要点：

1. 编译 Linux 二进制并上传 `bin/`、`web/`、`configs/` 到 `/opt/onlinenote/`，修改 `config.yaml`（端口、密钥、域名）。
2. nginx：复制 `deploy/nginx.conf` 到 `/etc/nginx/conf.d/onlinenote.conf`，改 `server_name` 后 `nginx -s reload`。
3. systemd：复制 `deploy/onlinenote.service` 到 `/etc/systemd/system/`，`systemctl enable --now onlinenote`。
4. 浏览器访问你的域名（或服务器 IP），注册或登录。

## 文档

- 设计文档：[doc/设计方案.md](doc/设计方案.md)
- 部署指南：[doc/部署说明.md](doc/部署说明.md)

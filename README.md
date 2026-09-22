# OnlineNote

个人自用的在线笔记软件（初版 v0.1）。浏览器访问，Markdown 编辑 + 实时预览，笔记以真实文件目录树组织，支持登录与注册（默认最多 5 个账号）。

## 功能特性

- ✅ **Typora 式所见即所得编辑**：直接在渲染的预览中书写，输入即实时渲染（`# ` 变标题、`**文字**` 变粗体、`- ` 变列表），中文输入法无干扰
- ✅ 单窗格「所见即所得 ⇄ 源码」切换（`Ctrl+/`），源码模式与本地编辑 `.md` 一致
- ✅ 编辑体验：Enter 换段、列表自动续项、块边界退格/删除合并、`Ctrl+Z` 撤销、`Ctrl+S` 保存
- ✅ Markdown 基础语法：标题、列表、引用、代码块、链接、图片、加粗、删除线等
- ✅ 文件目录树：SVG 精美图标、新建 / 重命名 / 删除笔记与文件夹（右键菜单）
- ✅ 用户登录 / 注册，注册人数上限默认 5（`auth.max_users` 可配置）
- ✅ **夜间主题**一键切换，自动记忆
- ✅ 笔记即文件：`data/notes/` 下的 `.md` 文件可直接备份、迁移、离线查看
- ✅ nginx 反向代理部署（附 nginx 配置与 systemd 服务单元）

## 技术栈

- **后端**：Go 1.24+ / Gin / SQLite（modernc 纯 Go 驱动）/ bcrypt / HMAC Cookie 会话
- **前端**：原生 HTML/CSS/JS 静态页面（零构建），内置轻量 Markdown 引擎（块级渲染 + 源码⇄DOM 位置映射）
- **部署**：nginx 反向代理 + systemd

## 目录结构

```
OnlineNote/
├── cmd/note/            主程序入口
├── cmd/notectl/         管理命令（初始化数据库、添加用户）
├── internal/            后端实现（config/model/store/service/session/middleware/handler/server）
├── web/                 前端静态页面（index.html / style.css / app.js / md.js）
├── doc/设计方案.md       设计文档
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

1. 上传 `bin/`、`web/`、`configs/` 到 `/opt/onlinenote/`，修改 `config.yaml`（端口、密钥、域名）。
2. nginx：复制 `deploy/nginx.conf` 到 `/etc/nginx/conf.d/onlinenote.conf`，改 `server_name` 后 `nginx -s reload`。
3. systemd：复制 `deploy/onlinenote.service` 到 `/etc/systemd/system/`，`systemctl enable --now onlinenote`。
4. 浏览器访问 `http://你的域名/`，注册或登录。

## 文档

- 设计文档：[doc/设计方案.md](doc/设计方案.md)

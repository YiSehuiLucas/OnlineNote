package model

// User 用户账号。
type User struct {
	ID           int64  `json:"id"`
	Username     string `json:"username"`
	PasswordHash string `json:"-"`
	CreatedAt    string `json:"created_at"`
}

// TreeNode 目录树节点，Path 为相对笔记根目录的路径（根节点为 ""）。
type TreeNode struct {
	Name     string      `json:"name"`
	Path     string      `json:"path"`
	Type     string      `json:"type"` // dir | file
	Children []*TreeNode `json:"children,omitempty"`
}

// Credentials 登录/注册请求体。
type Credentials struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

// FilePayload 保存文件请求体。
type FilePayload struct {
	Path    string `json:"path" binding:"required"`
	Content string `json:"content"`
}

// PathPayload 新建/查询路径请求体。
type PathPayload struct {
	Path string `json:"path" binding:"required"`
}

// MovePayload 重命名/移动请求体。
type MovePayload struct {
	From string `json:"from" binding:"required"`
	To   string `json:"to" binding:"required"`
}

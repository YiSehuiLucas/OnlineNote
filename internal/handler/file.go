package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"onlinenote/internal/model"
	"onlinenote/internal/service"
)

// File 文件操作处理器。所有操作都按当前登录用户隔离到各自的笔记目录。
type File struct {
	svc *service.Files
}

// NewFile 创建文件处理器。
func NewFile(svc *service.Files) *File {
	return &File{svc: svc}
}

// userSvc 解析当前登录用户的独立笔记服务（data/notes/<用户名>/）。
func (h *File) userSvc(c *gin.Context) (*service.Files, error) {
	username := c.GetString("username")
	if username == "" {
		return nil, errors.New("缺少用户身份")
	}
	return h.svc.ForUser(username)
}

// Tree 返回当前用户的目录树。
func (h *File) Tree(c *gin.Context) {
	svc, err := h.userSvc(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	t, err := svc.Tree()
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, t)
}

// Read 读取当前用户的文件内容。
func (h *File) Read(c *gin.Context) {
	svc, err := h.userSvc(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	p := c.Query("path")
	content, err := svc.ReadFile(p)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"path": p, "content": content})
}

// Save 保存当前用户的文件内容。
func (h *File) Save(c *gin.Context) {
	svc, err := h.userSvc(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	var req model.FilePayload
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}
	if err := svc.WriteFile(req.Path, req.Content); err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// Create 在当前用户目录下新建笔记文件。
func (h *File) Create(c *gin.Context) {
	svc, err := h.userSvc(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	var req model.PathPayload
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}
	if err := svc.CreateFile(req.Path); err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// Delete 删除当前用户的笔记文件。
func (h *File) Delete(c *gin.Context) {
	svc, err := h.userSvc(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	if err := svc.DeleteFile(c.Query("path")); err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// Mkdir 在当前用户目录下新建目录。
func (h *File) Mkdir(c *gin.Context) {
	svc, err := h.userSvc(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	var req model.PathPayload
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}
	if err := svc.CreateDir(req.Path); err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// Rmdir 删除当前用户的空目录。
func (h *File) Rmdir(c *gin.Context) {
	svc, err := h.userSvc(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	if err := svc.DeleteDir(c.Query("path")); err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// Move 重命名/移动当前用户的文件或目录。
func (h *File) Move(c *gin.Context) {
	svc, err := h.userSvc(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	var req model.MovePayload
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}
	if err := svc.Move(req.From, req.To); err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// fail 将服务层错误映射为 HTTP 状态码。
func (h *File) fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, service.ErrExists), errors.Is(err, service.ErrNotEmpty):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	case errors.Is(err, service.ErrInvalidPath), errors.Is(err, service.ErrNotMarkdown):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

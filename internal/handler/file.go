package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"onlinenote/internal/model"
	"onlinenote/internal/service"
)

// File 文件操作处理器。
type File struct {
	svc *service.Files
}

// NewFile 创建文件处理器。
func NewFile(svc *service.Files) *File {
	return &File{svc: svc}
}

// Tree 返回整棵目录树。
func (h *File) Tree(c *gin.Context) {
	t, err := h.svc.Tree()
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, t)
}

// Read 读取文件内容。
func (h *File) Read(c *gin.Context) {
	p := c.Query("path")
	content, err := h.svc.ReadFile(p)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"path": p, "content": content})
}

// Save 保存文件内容。
func (h *File) Save(c *gin.Context) {
	var req model.FilePayload
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}
	if err := h.svc.WriteFile(req.Path, req.Content); err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// Create 新建笔记文件。
func (h *File) Create(c *gin.Context) {
	var req model.PathPayload
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}
	if err := h.svc.CreateFile(req.Path); err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// Delete 删除笔记文件。
func (h *File) Delete(c *gin.Context) {
	if err := h.svc.DeleteFile(c.Query("path")); err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// Mkdir 新建目录。
func (h *File) Mkdir(c *gin.Context) {
	var req model.PathPayload
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}
	if err := h.svc.CreateDir(req.Path); err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// Rmdir 删除空目录。
func (h *File) Rmdir(c *gin.Context) {
	if err := h.svc.DeleteDir(c.Query("path")); err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// Move 重命名/移动文件或目录。
func (h *File) Move(c *gin.Context) {
	var req model.MovePayload
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}
	if err := h.svc.Move(req.From, req.To); err != nil {
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

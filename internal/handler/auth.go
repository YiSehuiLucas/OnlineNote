// Package handler 提供认证与文件相关 HTTP 处理器。
package handler

import (
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"

	"onlinenote/internal/model"
	"onlinenote/internal/session"
	"onlinenote/internal/store"
)

var usernameRe = regexp.MustCompile(`^[A-Za-z0-9_-]{2,32}$`)

// Auth 认证处理器。
type Auth struct {
	store    *store.Store
	sess     *session.Manager
	maxUsers int
}

// NewAuth 创建认证处理器。
func NewAuth(st *store.Store, sess *session.Manager, maxUsers int) *Auth {
	return &Auth{store: st, sess: sess, maxUsers: maxUsers}
}

// Register 注册新用户：校验格式 -> 人数上限 -> 重名 -> bcrypt 入库 -> 自动登录。
func (a *Auth) Register(c *gin.Context) {
	var req model.Credentials
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	if !usernameRe.MatchString(req.Username) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "用户名需为 2-32 位字母、数字、_ 或 -"})
		return
	}
	if len(req.Password) < 6 || len(req.Password) > 72 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "密码长度需为 6-72 位"})
		return
	}

	// 注册人数上限检查（先于插入，唯一约束兜底防并发）
	n, err := a.store.CountUsers()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器内部错误"})
		return
	}
	if n >= a.maxUsers {
		c.JSON(http.StatusForbidden, gin.H{"error": "注册人数已达上限（最多 " + strconv.Itoa(a.maxUsers) + " 人）"})
		return
	}

	if _, err := a.store.GetUserByName(req.Username); err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "用户名已存在"})
		return
	} else if err != store.ErrNotFound {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器内部错误"})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器内部错误"})
		return
	}
	user, err := a.store.CreateUser(req.Username, string(hash))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器内部错误"})
		return
	}

	a.sess.Set(c, user.ID, user.Username)
	c.JSON(http.StatusOK, gin.H{"username": user.Username})
}

// Login 登录并下发会话。
func (a *Auth) Login(c *gin.Context) {
	var req model.Credentials
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	user, err := a.store.GetUserByName(req.Username)
	if err != nil || bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)) != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "用户名或密码错误"})
		return
	}
	a.sess.Set(c, user.ID, user.Username)
	c.JSON(http.StatusOK, gin.H{"username": user.Username})
}

// Logout 登出。
func (a *Auth) Logout(c *gin.Context) {
	a.sess.Clear(c)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// Me 返回当前登录用户。
func (a *Auth) Me(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"username": c.GetString("username")})
}

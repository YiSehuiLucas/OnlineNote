// Package middleware 提供登录鉴权与登录/注册限速中间件。
package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"onlinenote/internal/session"
)

// RequireLogin 校验会话，并把用户信息写入上下文。
func RequireLogin(m *session.Manager) gin.HandlerFunc {
	return func(c *gin.Context) {
		uid, username, ok := m.Get(c)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "未登录或会话已过期"})
			return
		}
		c.Set("user_id", uid)
		c.Set("username", username)
		c.Next()
	}
}

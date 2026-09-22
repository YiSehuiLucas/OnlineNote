package middleware

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// IPLimiter 简单的固定窗口 IP 限速器（防登录/注册爆破，个人使用足够）。
type IPLimiter struct {
	mu     sync.Mutex
	window time.Duration
	limit  int
	hits   map[string][]time.Time
}

// NewIPLimiter 创建限速器。
func NewIPLimiter(limit int, window time.Duration) *IPLimiter {
	return &IPLimiter{limit: limit, window: window, hits: map[string][]time.Time{}}
}

// Allow 判断 key 是否允许本次请求。
func (l *IPLimiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	cut := now.Add(-l.window)
	kept := l.hits[key][:0]
	for _, t := range l.hits[key] {
		if t.After(cut) {
			kept = append(kept, t)
		}
	}
	if len(kept) >= l.limit {
		l.hits[key] = kept
		return false
	}
	l.hits[key] = append(kept, now)
	return true
}

// IPLimit 生成按 IP + 场景限速的中间件。
func IPLimit(l *IPLimiter, scope string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !l.Allow(c.ClientIP() + ":" + scope) {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"error": "尝试过于频繁，请稍后再试"})
			return
		}
		c.Next()
	}
}

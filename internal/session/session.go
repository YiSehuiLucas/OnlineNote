// Package session 实现 HMAC 签名的 Cookie 会话：Cookie 值 = Base64(载荷) + "." + 签名。
package session

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// CookieName 会话 Cookie 名。
const CookieName = "onlinenote_session"

// Manager 会话管理器。
type Manager struct {
	secret []byte
	maxAge time.Duration
}

// New 创建会话管理器。
func New(secret string, maxAge time.Duration) *Manager {
	return &Manager{secret: []byte(secret), maxAge: maxAge}
}

type payload struct {
	U int64  `json:"u"` // 用户 ID
	N string `json:"n"` // 用户名
	E int64  `json:"e"` // 过期时间（unix 秒）
}

// Set 写入会话 Cookie。
func (m *Manager) Set(c *gin.Context, uid int64, username string) {
	p := payload{U: uid, N: username, E: time.Now().Add(m.maxAge).Unix()}
	data, _ := json.Marshal(p)
	enc := base64.RawURLEncoding.EncodeToString(data)
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     CookieName,
		Value:    enc + "." + m.sign(enc),
		Path:     "/",
		MaxAge:   int(m.maxAge.Seconds()),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

// Get 校验并解析会话，返回用户 ID 与用户名。
func (m *Manager) Get(c *gin.Context) (int64, string, bool) {
	ck, err := c.Request.Cookie(CookieName)
	if err != nil || ck == nil {
		return 0, "", false
	}
	parts := strings.SplitN(ck.Value, ".", 2)
	if len(parts) != 2 {
		return 0, "", false
	}
	if !hmac.Equal([]byte(m.sign(parts[0])), []byte(parts[1])) {
		return 0, "", false
	}
	data, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return 0, "", false
	}
	var p payload
	if json.Unmarshal(data, &p) != nil {
		return 0, "", false
	}
	if time.Now().Unix() > p.E || p.U <= 0 {
		return 0, "", false
	}
	return p.U, p.N, true
}

// Clear 清除会话 Cookie。
func (m *Manager) Clear(c *gin.Context) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     CookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
	})
}

func (m *Manager) sign(s string) string {
	mac := hmac.New(sha256.New, m.secret)
	mac.Write([]byte(s))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

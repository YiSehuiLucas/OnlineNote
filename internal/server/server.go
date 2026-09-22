// Package server 负责路由注册与服务装配。
package server

import (
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"

	"onlinenote/internal/config"
	"onlinenote/internal/handler"
	"onlinenote/internal/middleware"
	"onlinenote/internal/service"
	"onlinenote/internal/session"
	"onlinenote/internal/store"
)

// New 装配并返回 Gin 引擎。
func New(cfg *config.Config, st *store.Store, fsvc *service.Files) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())

	sess := session.New(cfg.Auth.SessionSecret, time.Duration(cfg.Auth.SessionMaxAgeHours)*time.Hour)
	limiter := middleware.NewIPLimiter(10, 5*time.Minute)

	authH := handler.NewAuth(st, sess, cfg.Auth.MaxUsers)
	fileH := handler.NewFile(fsvc)

	api := r.Group("/api")
	{
		// 登录/注册：IP 限速防爆破
		api.POST("/auth/login", middleware.IPLimit(limiter, "login"), authH.Login)
		api.POST("/auth/register", middleware.IPLimit(limiter, "register"), authH.Register)
		api.POST("/auth/logout", authH.Logout)
		api.GET("/auth/me", middleware.RequireLogin(sess), authH.Me)

		// 文件操作：全部需要登录
		files := api.Group("", middleware.RequireLogin(sess))
		{
			files.GET("/tree", fileH.Tree)
			files.GET("/file", fileH.Read)
			files.PUT("/file", fileH.Save)
			files.POST("/file", fileH.Create)
			files.DELETE("/file", fileH.Delete)
			files.POST("/dir", fileH.Mkdir)
			files.DELETE("/dir", fileH.Rmdir)
			files.PUT("/move", fileH.Move)
		}
	}

	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// 开发模式：Go 直接托管前端静态目录（生产环境由 nginx 托管并反代 /api）。
	// 用 NoRoute + FileServer 而不是 r.Static("/")：根路径的通配路由会与 /api 前缀冲突。
	if cfg.Server.Static != "" {
		if info, err := os.Stat(cfg.Server.Static); err == nil && info.IsDir() {
			fs := http.FileServer(http.Dir(cfg.Server.Static))
			r.NoRoute(func(c *gin.Context) {
				if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
					c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
					return
				}
				fs.ServeHTTP(c.Writer, c.Request)
			})
		}
	}

	return r
}

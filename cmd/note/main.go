// OnlineNote 主程序入口。
package main

import (
	"flag"
	"log"

	"onlinenote/internal/config"
	"onlinenote/internal/server"
	"onlinenote/internal/service"
	"onlinenote/internal/store"
)

func main() {
	cfgPath := flag.String("config", "./configs/config.yaml", "配置文件路径")
	flag.Parse()

	cfg, err := config.Load(*cfgPath)
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}

	st, err := store.Open(cfg.Database.Path)
	if err != nil {
		log.Fatalf("打开数据库失败: %v", err)
	}
	defer st.Close()
	if err := st.Init(); err != nil {
		log.Fatalf("初始化数据库失败: %v", err)
	}

	fsvc, err := service.NewFiles(cfg.Storage.Root)
	if err != nil {
		log.Fatalf("初始化笔记目录失败: %v", err)
	}

	engine := server.New(cfg, st, fsvc)
	log.Printf("OnlineNote 已启动，监听 %s（笔记目录: %s，注册上限: %d 人）",
		cfg.Server.Addr, cfg.Storage.Root, cfg.Auth.MaxUsers)
	if err := engine.Run(cfg.Server.Addr); err != nil {
		log.Fatalf("服务启动失败: %v", err)
	}
}

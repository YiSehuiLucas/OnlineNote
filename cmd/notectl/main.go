// notectl 管理工具：初始化数据库、添加/查看用户。
//
// 用法：
//
//	notectl -config configs/config.yaml db init
//	notectl -config configs/config.yaml user add -username admin -password 密码
//	notectl -config configs/config.yaml user list
package main

import (
	"bufio"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"

	"golang.org/x/crypto/bcrypt"

	"onlinenote/internal/config"
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

	args := flag.Args()
	if len(args) == 0 {
		usage()
		os.Exit(1)
	}
	switch args[0] {
	case "db":
		if len(args) > 1 && args[1] == "init" {
			fmt.Printf("数据库已初始化: %s\n", cfg.Database.Path)
			return
		}
		usage()
	case "user":
		handleUser(st, cfg, args[1:])
	default:
		usage()
	}
}

func handleUser(st *store.Store, cfg *config.Config, args []string) {
	if len(args) == 0 {
		usage()
		return
	}
	switch args[0] {
	case "add":
		username, password := "", ""
		rest := args[1:]
		for i := 0; i < len(rest); i++ {
			switch rest[i] {
			case "-username", "--username":
				if i+1 < len(rest) {
					username = rest[i+1]
					i++
				}
			case "-password", "--password":
				if i+1 < len(rest) {
					password = rest[i+1]
					i++
				}
			}
		}
		username = strings.TrimSpace(username)
		if username == "" {
			fmt.Print("用户名: ")
			username = readLine()
		}
		if password == "" {
			fmt.Print("密码: ")
			password = readLine()
		}
		if len(username) < 2 || len(username) > 32 {
			log.Fatal("用户名长度需为 2-32 位")
		}
		if len(password) < 6 || len(password) > 72 {
			log.Fatal("密码长度需为 6-72 位")
		}
		if _, err := st.GetUserByName(username); err == nil {
			log.Fatalf("用户 %s 已存在", username)
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
		if err != nil {
			log.Fatalf("密码哈希失败: %v", err)
		}
		user, err := st.CreateUser(username, string(hash))
		if err != nil {
			log.Fatalf("创建用户失败: %v", err)
		}
		fmt.Printf("用户创建成功: %s (ID %d)\n", user.Username, user.ID)
	case "del":
		username := ""
		rest := args[1:]
		for i := 0; i < len(rest); i++ {
			if rest[i] == "-username" || rest[i] == "--username" {
				if i+1 < len(rest) {
					username = strings.TrimSpace(rest[i+1])
					i++
				}
			}
		}
		if username == "" {
			fmt.Print("用户名: ")
			username = strings.TrimSpace(readLine())
		}
		if username == "" {
			log.Fatal("请输入用户名")
		}
		// 先取用户 ID（归档笔记目录需要），再删除账号
		user, err := st.GetUserByName(username)
		if err != nil {
			log.Fatalf("删除失败: %v", err)
		}
		if err := st.DeleteUserByUsername(username); err != nil {
			log.Fatalf("删除失败: %v", err)
		}
		// 归档该用户的笔记目录（防止同名账号重新注册后继承旧笔记）
		if fsvc, err := service.NewFiles(cfg.Storage.Root); err == nil {
			if err := fsvc.ArchiveUserDir(username, user.ID); err != nil {
				fmt.Printf("警告: %v\n", err)
			}
		}
		fmt.Printf("用户已删除: %s\n", username)
	case "list":
		n, err := st.CountUsers()
		if err != nil {
			log.Fatalf("查询失败: %v", err)
		}
		users, err := st.ListUsers()
		if err != nil {
			log.Fatalf("查询失败: %v", err)
		}
		fmt.Printf("共 %d 个账号\n", n)
		for _, u := range users {
			fmt.Printf("  [%d] %s（创建于 %s）\n", u.ID, u.Username, u.CreatedAt)
		}
	default:
		usage()
	}
}

func readLine() string {
	r := bufio.NewReader(os.Stdin)
	s, err := r.ReadString('\n')
	if err != nil && s == "" {
		log.Fatal("读取输入失败")
	}
	return strings.TrimRight(s, "\r\n")
}

func usage() {
	fmt.Println(`用法:
  notectl -config configs/config.yaml db init
  notectl -config configs/config.yaml user add -username 用户名 -password 密码
  notectl -config configs/config.yaml user del -username 用户名
  notectl -config configs/config.yaml user list`)
}

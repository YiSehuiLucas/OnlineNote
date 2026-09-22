.PHONY: build run tidy db-init user-list

# 编译主程序与管理工具
build:
	go build -o bin/note ./cmd/note
	go build -o bin/notectl ./cmd/notectl

# 本地运行（开发模式，Go 直接托管 web/ 静态文件）
run:
	go run ./cmd/note -config configs/config.yaml

# 初始化数据库
db-init:
	go run ./cmd/notectl -config configs/config.yaml db init

# 查看账号列表与剩余名额
user-list:
	go run ./cmd/notectl -config configs/config.yaml user list

# 拉取依赖
tidy:
	go mod tidy

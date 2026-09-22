package config

import (
	"os"

	"gopkg.in/yaml.v3"
)

// Config 应用配置，字段与 configs/config.yaml 一一对应。
type Config struct {
	Server struct {
		// Addr 服务监听地址，生产环境仅监听本机，由 nginx 对外提供入口。
		Addr string `yaml:"addr"`
		// Static 前端静态文件目录；目录不存在时以纯 API 模式运行。
		Static string `yaml:"static"`
	} `yaml:"server"`

	Auth struct {
		// MaxUsers 注册人数上限（含预置账号）。
		MaxUsers int `yaml:"max_users"`
		// SessionSecret 会话 HMAC 签名密钥，部署时务必修改。
		SessionSecret string `yaml:"session_secret"`
		// SessionMaxAgeHours 会话有效期（小时）。
		SessionMaxAgeHours int `yaml:"session_max_age_hours"`
	} `yaml:"auth"`

	Storage struct {
		// Root 笔记根目录（真实文件树）。
		Root string `yaml:"root"`
	} `yaml:"storage"`

	Database struct {
		// Path SQLite 数据库文件路径。
		Path string `yaml:"path"`
	} `yaml:"database"`
}

// Default 返回带默认值的配置。
func Default() *Config {
	c := &Config{}
	c.Server.Addr = "127.0.0.1:8080"
	c.Server.Static = "./web"
	c.Auth.MaxUsers = 5
	c.Auth.SessionSecret = "change-me"
	c.Auth.SessionMaxAgeHours = 168
	c.Storage.Root = "./data/notes"
	c.Database.Path = "./data/note.db"
	return c
}

// Load 读取 YAML 配置文件；文件不存在时返回默认配置（便于开箱即用）。
func Load(path string) (*Config, error) {
	c := Default()
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return c, nil
		}
		return nil, err
	}
	if err := yaml.Unmarshal(data, c); err != nil {
		return nil, err
	}
	return c, nil
}

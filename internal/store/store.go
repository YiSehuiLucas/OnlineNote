// Package store 提供 SQLite 用户表访问层。
package store

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite" // 纯 Go SQLite 驱动

	"onlinenote/internal/model"
)

// ErrNotFound 记录不存在。
var ErrNotFound = errors.New("记录不存在")

// Store 数据库访问层。
type Store struct {
	db *sql.DB
}

// Open 打开（必要时创建）SQLite 数据库。
func Open(path string) (*Store, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	if dir := filepath.Dir(abs); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("创建数据库目录失败: %w", err)
		}
	}
	dsn := "file:" + filepath.ToSlash(abs) + "?_pragma=busy_timeout(5000)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// 单写入者场景，限制连接数避免 SQLITE_BUSY。
	db.SetMaxOpenConns(1)
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

// Close 关闭数据库。
func (s *Store) Close() error { return s.db.Close() }

// Init 建表（幂等）。
func (s *Store) Init() error {
	_, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS users (
		id            INTEGER PRIMARY KEY AUTOINCREMENT,
		username      TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL,
		created_at    TEXT NOT NULL DEFAULT (datetime('now'))
	)`)
	return err
}

// CountUsers 当前账号总数（用于注册人数上限判断）。
func (s *Store) CountUsers() (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}

// CreateUser 新建用户。
func (s *Store) CreateUser(username, passwordHash string) (*model.User, error) {
	res, err := s.db.Exec(`INSERT INTO users (username, password_hash) VALUES (?, ?)`, username, passwordHash)
	if err != nil {
		return nil, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}
	return s.GetUserByID(id)
}

// GetUserByID 按 ID 查询。
func (s *Store) GetUserByID(id int64) (*model.User, error) {
	u := &model.User{}
	err := s.db.QueryRow(`SELECT id, username, password_hash, created_at FROM users WHERE id = ?`, id).
		Scan(&u.ID, &u.Username, &u.PasswordHash, &u.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return u, nil
}

// GetUserByName 按用户名查询。
func (s *Store) GetUserByName(username string) (*model.User, error) {
	u := &model.User{}
	err := s.db.QueryRow(`SELECT id, username, password_hash, created_at FROM users WHERE username = ?`, username).
		Scan(&u.ID, &u.Username, &u.PasswordHash, &u.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return u, nil
}

// ListUsers 列出全部用户。
func (s *Store) ListUsers() ([]model.User, error) {
	rows, err := s.db.Query(`SELECT id, username, password_hash, created_at FROM users ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	users := []model.User{}
	for rows.Next() {
		u := model.User{}
		if err := rows.Scan(&u.ID, &u.Username, &u.PasswordHash, &u.CreatedAt); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

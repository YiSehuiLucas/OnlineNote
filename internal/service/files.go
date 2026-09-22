// Package service 提供笔记文件树操作，所有路径统一做穿越防护。
package service

import (
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"onlinenote/internal/model"
)

var (
	// ErrInvalidPath 非法路径（含目录穿越尝试）。
	ErrInvalidPath = errors.New("非法路径")
	// ErrNotFound 文件或目录不存在。
	ErrNotFound = errors.New("文件或目录不存在")
	// ErrExists 已存在同名文件或目录。
	ErrExists = errors.New("已存在同名文件或目录")
	// ErrNotEmpty 目录非空，拒绝删除。
	ErrNotEmpty = errors.New("目录非空，不能删除")
	// ErrNotMarkdown 仅支持 .md 文件。
	ErrNotMarkdown = errors.New("仅支持 .md 文件")
)

// Files 笔记文件服务。
type Files struct {
	root string
}

// NewFiles 创建服务并确保笔记根目录存在。
func NewFiles(root string) (*Files, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(abs, 0o755); err != nil {
		return nil, fmt.Errorf("创建笔记根目录失败: %w", err)
	}
	return &Files{root: abs}, nil
}

// resolve 将相对路径解析为根目录内的绝对路径，防止目录穿越。
func (f *Files) resolve(rel string) (string, error) {
	rel = strings.TrimSpace(rel)
	rel = strings.ReplaceAll(rel, "\\", "/")
	rel = strings.TrimPrefix(rel, "./")
	if rel == "" || rel == "." || rel == "/" {
		return f.root, nil
	}
	if strings.HasPrefix(rel, "/") || (len(rel) >= 2 && rel[1] == ':') {
		// 拒绝绝对路径与 Windows 盘符路径
		return "", ErrInvalidPath
	}
	clean := path.Clean(rel)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, "../") {
		return "", ErrInvalidPath
	}
	abs := filepath.Join(f.root, filepath.FromSlash(clean))
	if !strings.HasPrefix(abs, f.root+string(os.PathSeparator)) {
		return "", ErrInvalidPath
	}
	return abs, nil
}

// withExt 文件路径自动补 .md 后缀。
func withExt(p string) string {
	if !strings.HasSuffix(p, ".md") {
		return p + ".md"
	}
	return p
}

// Tree 返回整棵目录树（只包含目录与 .md 文件，隐藏点开头条目）。
func (f *Files) Tree() (*model.TreeNode, error) {
	return f.buildDir("", f.root)
}

func (f *Files) buildDir(rel, abs string) (*model.TreeNode, error) {
	node := &model.TreeNode{Name: filepath.Base(abs), Path: rel, Type: "dir"}
	if rel == "" {
		node.Name = "笔记"
	}
	entries, err := os.ReadDir(abs)
	if err != nil {
		return nil, err
	}
	dirs := []os.DirEntry{}
	files := []os.DirEntry{}
	for _, e := range entries {
		name := e.Name()
		if strings.HasPrefix(name, ".") {
			continue // 隐藏文件/目录不展示
		}
		if e.IsDir() {
			dirs = append(dirs, e)
		} else if strings.HasSuffix(name, ".md") {
			files = append(files, e)
		}
	}
	sort.Slice(dirs, func(i, j int) bool { return dirs[i].Name() < dirs[j].Name() })
	sort.Slice(files, func(i, j int) bool { return files[i].Name() < files[j].Name() })
	for _, d := range dirs {
		child, err := f.buildDir(joinRel(rel, d.Name()), filepath.Join(abs, d.Name()))
		if err != nil {
			return nil, err
		}
		node.Children = append(node.Children, child)
	}
	for _, fl := range files {
		node.Children = append(node.Children, &model.TreeNode{
			Name: fl.Name(),
			Path: joinRel(rel, fl.Name()),
			Type: "file",
		})
	}
	return node, nil
}

// joinRel 以 / 连接相对路径片段。
func joinRel(rel, name string) string {
	if rel == "" {
		return name
	}
	return rel + "/" + name
}

// fileAbs 解析文件路径：若路径本身是目录则报 ErrNotMarkdown，否则自动补 .md 后缀。
func (f *Files) fileAbs(rel string) (string, error) {
	abs, err := f.resolve(rel)
	if err != nil {
		return "", err
	}
	if info, err := os.Stat(abs); err == nil && info.IsDir() {
		return "", ErrNotMarkdown
	}
	return withExt(abs), nil
}

// ReadFile 读取笔记内容。
func (f *Files) ReadFile(rel string) (string, error) {
	abs, err := f.fileAbs(rel)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return "", ErrNotFound
		}
		return "", err
	}
	if info.IsDir() {
		return "", ErrNotMarkdown
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// WriteFile 保存笔记内容（文件必须已存在）。
func (f *Files) WriteFile(rel, content string) error {
	abs, err := f.fileAbs(rel)
	if err != nil {
		return err
	}
	info, err := os.Stat(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return ErrNotFound
		}
		return err
	}
	if info.IsDir() {
		return ErrNotMarkdown
	}
	return os.WriteFile(abs, []byte(content), 0o644)
}

// CreateFile 新建笔记文件（自动补 .md，已存在则报错）。
func (f *Files) CreateFile(rel string) error {
	abs, err := f.resolve(rel)
	if err != nil {
		return err
	}
	if info, err := os.Stat(abs); err == nil {
		if info.IsDir() {
			return ErrExists // 已存在同名目录
		}
		return ErrExists
	}
	abs = withExt(abs)
	if _, err := os.Stat(abs); err == nil {
		return ErrExists
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return err
	}
	file, err := os.OpenFile(abs, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		if os.IsExist(err) {
			return ErrExists
		}
		return err
	}
	return file.Close()
}

// DeleteFile 删除笔记文件。
func (f *Files) DeleteFile(rel string) error {
	abs, err := f.fileAbs(rel)
	if err != nil {
		return err
	}
	info, err := os.Stat(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return ErrNotFound
		}
		return err
	}
	if info.IsDir() {
		return ErrNotMarkdown
	}
	return os.Remove(abs)
}

// CreateDir 新建目录（支持多级，已存在则报错）。
func (f *Files) CreateDir(rel string) error {
	abs, err := f.resolve(rel)
	if err != nil {
		return err
	}
	if abs == f.root {
		return ErrExists
	}
	if _, err := os.Stat(abs); err == nil {
		return ErrExists
	}
	return os.MkdirAll(abs, 0o755)
}

// DeleteDir 删除空目录（根目录与非空目录拒绝）。
func (f *Files) DeleteDir(rel string) error {
	abs, err := f.resolve(rel)
	if err != nil {
		return err
	}
	if abs == f.root {
		return errors.New("不能删除笔记根目录")
	}
	entries, err := os.ReadDir(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return ErrNotFound
		}
		return err
	}
	if len(entries) > 0 {
		return ErrNotEmpty
	}
	return os.Remove(abs)
}

// Move 重命名/移动文件或目录（目标已存在则报错，不覆盖）。
func (f *Files) Move(from, to string) error {
	to = strings.TrimSpace(to)
	if to == "" || to == "/" {
		return ErrInvalidPath
	}
	absFrom, err := f.resolve(from)
	if err != nil {
		return err
	}
	info, err := os.Stat(absFrom)
	if err != nil {
		if os.IsNotExist(err) {
			return ErrNotFound
		}
		return err
	}
	isDir := info.IsDir()
	if !isDir && !strings.HasSuffix(from, ".md") {
		// 未带扩展名时自动补全后再定位
		absFrom = withExt(absFrom)
		if _, err := os.Stat(absFrom); err != nil {
			if os.IsNotExist(err) {
				return ErrNotFound
			}
			return err
		}
	}
	absTo, err := f.resolve(to)
	if err != nil {
		return err
	}
	if !isDir {
		absTo = withExt(absTo)
	}
	return f.rename(absFrom, absTo)
}

// rename 执行重命名，拒绝覆盖已存在目标与根目录。
func (f *Files) rename(from, to string) error {
	if from == f.root {
		return errors.New("不能移动或重命名笔记根目录")
	}
	if _, err := os.Stat(to); err == nil {
		return ErrExists
	}
	if err := os.MkdirAll(filepath.Dir(to), 0o755); err != nil {
		return err
	}
	if err := os.Rename(from, to); err != nil {
		if os.IsNotExist(err) {
			return ErrNotFound
		}
		return err
	}
	return nil
}

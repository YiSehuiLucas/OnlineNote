package service

import (
	"os"
	"path/filepath"
	"testing"
)

// TestUserIsolation 验证不同用户的笔记目录完全隔离。
func TestUserIsolation(t *testing.T) {
	root := t.TempDir()
	base, err := NewFiles(root)
	if err != nil {
		t.Fatal(err)
	}

	alice, err := base.ForUser("alice")
	if err != nil {
		t.Fatal(err)
	}
	bob, err := base.ForUser("bob")
	if err != nil {
		t.Fatal(err)
	}

	// alice 建目录与笔记
	if err := alice.CreateDir("工作"); err != nil {
		t.Fatal(err)
	}
	if err := alice.CreateFile("工作/秘密.md"); err != nil {
		t.Fatal(err)
	}
	if err := alice.WriteFile("工作/秘密.md", "alice 的内容"); err != nil {
		t.Fatal(err)
	}

	// bob 的目录树应为空
	tree, err := bob.Tree()
	if err != nil {
		t.Fatal(err)
	}
	if len(tree.Children) != 0 {
		t.Fatalf("bob 应看到空树，实际 %d 项", len(tree.Children))
	}

	// bob 读不到、改不了、删不掉、移不动 alice 的笔记
	if _, err := bob.ReadFile("工作/秘密.md"); err != ErrNotFound {
		t.Fatalf("bob 读 alice 笔记应 ErrNotFound，实际 %v", err)
	}
	if err := bob.WriteFile("工作/秘密.md", "hack"); err != ErrNotFound {
		t.Fatalf("bob 覆盖 alice 笔记应 ErrNotFound，实际 %v", err)
	}
	if err := bob.DeleteFile("工作/秘密.md"); err != ErrNotFound {
		t.Fatalf("bob 删除 alice 笔记应 ErrNotFound，实际 %v", err)
	}
	if err := bob.Move("工作", "工作2"); err != ErrNotFound {
		t.Fatalf("bob 移动 alice 目录应 ErrNotFound，实际 %v", err)
	}

	// alice 自己的笔记不受影响
	content, err := alice.ReadFile("工作/秘密.md")
	if err != nil || content != "alice 的内容" {
		t.Fatalf("alice 应能读自己的笔记，content=%q err=%v", content, err)
	}

	// 删除用户后归档其笔记目录：同名账号重新注册看不到旧笔记
	if err := base.ArchiveUserDir("alice", 42); err != nil {
		t.Fatal(err)
	}
	alice2, err := base.ForUser("alice")
	if err != nil {
		t.Fatal(err)
	}
	tree2, err := alice2.Tree()
	if err != nil {
		t.Fatal(err)
	}
	if len(tree2.Children) != 0 {
		t.Fatalf("重新注册的同名用户应看到空树，实际 %d 项", len(tree2.Children))
	}
	if _, err := os.Stat(filepath.Join(root, ".deleted-alice-42")); err != nil {
		t.Fatalf("归档目录应存在: %v", err)
	}

	// 非法用户名防御
	if _, err := base.ForUser("../evil"); err == nil {
		t.Fatal("非法用户名应被拒绝")
	}
	if _, err := base.ForUser("a/b"); err == nil {
		t.Fatal("带斜杠的用户名应被拒绝")
	}
}

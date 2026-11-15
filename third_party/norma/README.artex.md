# third_party/norma — patched copy of the agent SDK

这是 `github.com/Autumn-27/norma` 的**本地改造副本**，让仓库可以自包含地构建
（`go.mod` 里 `replace github.com/Autumn-27/norma => ./third_party/norma`）。

上游：https://github.com/Autumn-27/norma
基线：v0.4.3 对应的公开 HEAD（`4f5684e`，2026-10-18），无 git 历史。

## 为什么要在仓库里带一份

上下文治理需要"把某一轮从模型历史里删掉"的能力，而 v0.4.3 的 hook 只能注入、不能改历史。
把补丁放在仓库外（例如 `../项目分析/norma-src`）会导致**别人 clone 下来编译不了**，
所以副本随仓库一起走。

## 相对上游的全部改动（只有 2 个文件）

### 1. `hook/hook.go`

- `Result` 新增字段：

  ```go
  // UpdatedMessages replaces the conversation history the model will see
  // (UserPromptSubmit). nil 表示不改。
  UpdatedMessages []llm.Message
  ```

- `FireUserPromptSubmit` 签名改为携带并返回历史：

  ```go
  func (r *Registry) FireUserPromptSubmit(ctx context.Context, prompt string, messages []llm.Message) (string, []llm.Message)
  ```

  `Event.Messages` 现在会填上当前历史；最后一个返回非 nil 的 hook 生效。

### 2. `agentcore/agentcore.go`

- `hookFirer` 接口签名同步。
- `Prompt` 里在触发 `UserPromptSubmit` 之后：

  ```go
  if updated != nil {
      s.messages = updated
  }
  ```

## 定位：自研分支，不跟上游

维护者已决定：**这份 norma 视为我们自己的二开分支，不向上游提 PR，也不自动跟随上游版本。**
需要上游的新能力时手动搬运并重新打补丁。

升级步骤：

1. 拉上游新版，覆盖本目录（保留上面两处改动）。
2. `go build ./...` 验证。
3. 若某天上游原生支持了"可替换历史"，删掉本目录并去掉 `go.mod` 的 `replace`。

## 验证

`ARTEX/agent/context_scrub_session_test.go` 覆盖了整条链路：
手写含拒答轮的 transcript → `Resume` → `Prompt` → hook 返回新历史 → 会话里拒答轮消失。
（v0.67 曾误判为"空转"，实为验证夹具绕过了 `ma.Chat`，详见 CHANGELOG v0.68。）

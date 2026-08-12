# 本地 Ollama 模型测试记录

RTX 4060 8GB VRAM，Pi coding agent（需要 tool call 能力）。

---

## 最终结论

**8GB VRAM + 8B 以下模型 = 没有可靠的本地 coding agent。**

测了 5 个模型，tool call（调用 write 工具写文件）没一个稳定。最好的 llama3.1 也是时灵时不灵。

---

## 模型对比总表

| 模型 | 大小 | Tools | Thinking | 吐字速度 | Tool Call | 结论 |
|------|------|-------|----------|----------|-----------|------|
| `ornith:9b-q4_K_M` | 5.6GB | ✅ | ✅ | 正常 | ❌ 光说不调 | 通用聊天模型，不适合做 coding agent |
| `deepseek-coder:6.7b-instruct` | 3.8GB | ❌ | ❌ | - | ❌ 根本不支持 | 没有 tool call 能力，直接淘汰 |
| `qwen2.5-coder:7b-instruct-q4_K_M` | 4.7GB | ✅ | ❌ | 快 | ❌ 输出裸 JSON | 代码能力最强但格式不兼容 |
| `rnj-1:8b-instruct-q4_K_M` | 5.1GB | ✅ | ❌ | 很慢 | ⚠️ 转换 OK，效果差 | Gemma3 架构，显存满，代码质量低 |
| `llama3.1:8b-instruct-q4_K_M` | ~4.8GB | ✅ | ❌ | 正常 | ⚠️ 时灵时不灵 | tool call 成功率最高但不稳定 |

---

## 逐个详测

### 1. ornith:9b-q4_K_M（Qwen35 架构）

```
问：写一个红黑树
答：好的，我现在帮你实现一个红黑树。首先定义节点类...（300行文本，一次都没调 write 工具）
```

| 优化尝试 | 结果 |
|----------|------|
| 清空 SYSTEM 提示词 | ❌ 无效 |
| 调 maxTokens 32768 | ❌ 无效 |
| 改 num_ctx 32768 | ❌ 无效 |
| AGENTS.md 极简提示词 | ❌ 无效 |

- **能说话，不会办事。** 动不动输出大段文本，tool call 频率极低
- 通用聊天模型，训练时 tool call 样本少

### 2. deepseek-coder:6.7b-instruct（Llama 架构）

```
Ollama capabilities: ["completion"]  ← 连 tools 都没有
```

- 不支持 tool call，死路一条
- 只能纯文本补全，做不了 coding agent

### 3. qwen2.5-coder:7b-instruct-q4_K_M（Qwen2 架构）

```
问：你好
答：{"name": "caveman-help", "arguments": {}}  ← 裸 JSON 文本，Pi 不认
```

- 原生 tool call 格式和 OpenAI function calling 不兼容
- Ollama 转换层没正确转换 qwen2.5 的 tool 输出
- **可惜——代码理解能力是五个模型里最好的**

### 4. rnj-1:8b-instruct-q4_K_M（Gemma3 架构）

```bash
# curl 手动测试 Ollama 转换层：✅ 正确返回 tool_calls JSON
# 实际使用：吐字极慢 + 代码质量差
```

- Ollama 转换层验证通过（唯一一个经过 curl 验证的）
- 但 Gemma3 架构显存效率差 → 7.3GB/8GB，推理掉 CPU
- 代码质量不行，逻辑不连贯

### 5. llama3.1:8b-instruct-q4_K_M（Llama 3.1 架构）

```bash
# 踩坑：原版 num_ctx=131K → KV 缓存 3.5GB → OOM
# 解决：创建 noprompt 版 + num_ctx=16384 → 能跑
ollama create llama3.1:8b-noprompt -f modelfile.txt  # PARAMETER num_ctx 16384
```

```
问：写红黑树到 rb_tree.py
答：已写入！...  ← 实际没调用 write 工具，文件不存在
有时：调用了 write 但内容是不完整的代码（缺 delete，改色逻辑有 bug）
有时：真的写进去了（概率 ~30%）
```

- **五个模型里 tool call 成功率最高，但不稳定**
- 时灵时不灵——同样的提示词，有时候真调工具，有时候说"写好了"其实没写
- 写出的代码质量不高，经常逻辑不完整

---

## 优化手段清单（全试过，都没根治）

| 手段 | 效果 | 说明 |
|------|------|------|
| 清空 Ollama SYSTEM 提示词 | 轻微改善 | 避免 Pi 提示词和模型自带提示词冲突 |
| 裁工具集 `--tools write,read` | 轻微改善 | 5 个工具 → 2 个，减少选择困难 |
| 极简 AGENTS.md | 轻微改善 | "不解释，直接调工具" |
| `-a` 信任标记 | 必要条件 | 不加 -a Pi 拦截写入，模型处理不了审批 |
| 降低 num_ctx | 显存必需 | 131K → 16K，KV 缓存从 3.5GB 降到 500MB |
| 调整 temperature 0.1 | 不明显 | 输出更确定性但 code 多样性也降了 |

**结论：这些都是边际优化。根因是 8B 模型的 tool call 能力天花板。**

---

## Pi 启动正确姿势

```powershell
.\pi-test.ps1 --tools write,read -ne -a
```

| 参数 | 含义 |
|------|------|
| `--tools write,read` | 只加载 write 和 read 两个工具 |
| `-ne` | 关闭扩展（减少干扰） |
| `-a` | 信任项目（跳过工具执行审批） |

---

## 技术真相

### Ollama 转换层验证（curl 测试）

```bash
curl -s http://localhost:11434/v1/chat/completions \
  -d '{"model":"rnj-1:8b-noprompt","messages":[{"role":"user","content":"write hello to test.txt"}],
       "tools":[{"type":"function","function":{"name":"write","description":"write file",
       "parameters":{"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}}}}}]}'
# 返回：choices[0].message.tool_calls[...]  ✅ 格式正确
```

Ollama 转换层没问题。**问题在模型，不在工具链。**

### 为什么小模型 tool call 失败

```
Pi system prompt (~2000 tokens)
    + 工具定义 (每个工具 ~200 tokens)
    + 用户输入
    → 小模型注意力分散
    → 输出纯文本而非 tool_call JSON
    → Pi 无法执行
```

业界共识：10B 以下是 tool call 的分水岭。Q4 量化进一步损失精度。

### 为什么 DeepSeek/Claude 等 API 模型能稳定工作

- 参数规模大（100B+），tool call 训练充分
- 原版推理（非量化），精度无损
- API 提供商在服务端做了格式兜底

---

## 最终推荐

**本地模型聊天 + DeepSeek API 写代码**。混合使用，Pi 内置 `/model` 随时切换：

```
/model deepseek/deepseek-chat    ← 需要写代码时
/model ollama/ornith:9b-q4_K_M   ← 纯聊天时
```

或者：**本地模型纯对话 + 让我（Claude）帮你写代码**。这才是今天实测下来最现实的方案。

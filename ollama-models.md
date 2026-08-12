# 本地 Ollama 模型一览

RTX 4060 8GB VRAM | Ollama 服务端口 11434

---

## 启动 Ollama

```powershell
ollama serve
```

或后台：

```powershell
Start-Process ollama -ArgumentList "serve" -WindowStyle Hidden
```

---

## 已部署模型 (10 个)

### 可直接用于 Pi（noprompt 版，清空 SYSTEM 提示词）

| 模型 | 大小 | 架构 | Tools | 启动方式 |
|------|------|------|-------|---------|
| `llama3.1:8b-noprompt` | 4.9GB | Llama 3.1 | ✅ | `ollama run llama3.1:8b-noprompt` |
| `rnj-1:8b-noprompt` | 5.1GB | Gemma3 | ✅ | `ollama run rnj-1:8b-noprompt` |
| `qwen2.5-coder:7b-noprompt` | 4.7GB | Qwen2 | ✅ | `ollama run qwen2.5-coder:7b-noprompt` |
| `ornith:9b-noprompt` | 5.6GB | Qwen35 | ✅ | `ollama run ornith:9b-noprompt` |

### 原版模型（自带 SYSTEM 提示词，Pi 用会有冲突）

| 模型 | 大小 | 架构 | 启动方式 |
|------|------|------|---------|
| `llama3.1:8b-instruct-q4_K_M` | 4.9GB | Llama 3.1 | `ollama run llama3.1:8b-instruct-q4_K_M` |
| `rnj-1:8b-instruct-q4_K_M` | 5.1GB | Gemma3 | `ollama run rnj-1:8b-instruct-q4_K_M` |
| `qwen2.5-coder:7b-instruct-q4_K_M` | 4.7GB | Qwen2 | `ollama run qwen2.5-coder:7b-instruct-q4_K_M` |
| `ornith:9b-ctx32k` | 5.6GB | Qwen35 | `ollama run ornith:9b-ctx32k` |
| `ornith:9b-q4_K_M` | 5.6GB | Qwen35 | `ollama run ornith:9b-q4_K_M` |
| `deepseek-coder:6.7b-instruct` | 3.8GB | Llama | `ollama run deepseek-coder:6.7b-instruct` |

---

## 快速切换模型

```powershell
.\switch-model.ps1
```

数字菜单选择，自动卸载旧模型释放显存。

---

## 部署新模型

```powershell
# 1. 拉取
ollama pull <模型名>

# 2. 创建 noprompt 版（清空 SYSTEM，设置上下文）
printf 'FROM <模型名>\nSYSTEM ""\nPARAMETER num_ctx 16384' > modelfile.txt
ollama create <模型名>-noprompt -f modelfile.txt

# 3. 切换
.\switch-model.ps1
```

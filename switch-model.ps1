# 本地模型切换器 - 自动发现 Ollama 模型，数字菜单
param([string]$ModelKey)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# 从 Ollama 自动发现可用的 noprompt 模型
try {
    $raw = Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -Method Get -TimeoutSec 5 -ErrorAction Stop
    $allNames = $raw.models.name
} catch {
    Write-Host ""
    Write-Host "ERROR: Cannot reach Ollama at localhost:11434" -ForegroundColor Red
    Write-Host "Make sure Ollama is running: ollama serve" -ForegroundColor Yellow
    Write-Host ""
    pause
    exit 1
}

$modelList = @($allNames | Sort-Object)

# 读取当前配置
$settingsPath = Join-Path $scriptDir ".pi\settings.json"
$currentSettings = Get-Content $settingsPath -Encoding UTF8 -Raw | ConvertFrom-Json
$currentModel = $currentSettings.defaultModel

# 无参数 -> 菜单
if (-not $ModelKey) {
    Write-Host ""
    Write-Host "===========================================" -ForegroundColor Cyan
    Write-Host "  Ollama Model Switcher" -ForegroundColor Cyan
    Write-Host "===========================================" -ForegroundColor Cyan
    Write-Host ""

    # GPU 显存状态
    $gpuInfo = & nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader 2>$null
    if ($gpuInfo) {
        $parts = $gpuInfo -split ", "
        if ($parts.Count -eq 2) {
            $used = 0; $total = 0
            [int]::TryParse(($parts[0] -replace ' MiB', ''), [ref]$used) | Out-Null
            [int]::TryParse(($parts[1] -replace ' MiB', ''), [ref]$total) | Out-Null
            if ($total -gt 0) {
                $pct = [math]::Round($used / $total * 100)
                $c = "Green"; if ($pct -gt 80) { $c = "Red" }
                Write-Host "  VRAM: ${used}M / ${total}M (${pct}pct)" -ForegroundColor $c
            }
        }
    }
    Write-Host ""

    # 列出模型
    for ($i = 0; $i -lt $modelList.Count; $i++) {
        $name = $modelList[$i]
        $num = $i + 1
        $tag = ""
        if ($name -eq $currentModel) { $tag = " <-- current" }
        Write-Host "  $num. $name$tag" -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "  0. exit" -ForegroundColor Gray
    Write-Host ""
    $max = $modelList.Count
    $choice = Read-Host "pick model (1-$max)"

    if ($choice -eq "0" -or $choice -eq "") {
        Write-Host "cancelled" -ForegroundColor Gray
        exit 0
    }

    $idx = 0
    [int]::TryParse($choice, [ref]$idx) | Out-Null
    if ($idx -lt 1 -or $idx -gt $max) {
        Write-Host "ERROR: invalid: $choice (range 1-$max)" -ForegroundColor Red
        exit 1
    }
    $ModelKey = $modelList[$idx - 1]
}

# 验证模型存在
if ($modelList -notcontains $ModelKey) {
    Write-Host "ERROR: model $ModelKey not found in Ollama" -ForegroundColor Red
    Write-Host "Available: $($modelList -join ', ')"
    exit 1
}

$modelId = $ModelKey

Write-Host ""
Write-Host "=== Switching to: $modelId ===" -ForegroundColor Cyan
Write-Host ""

# 卸载当前运行模型
Write-Host "[1/2] Unloading old models..." -ForegroundColor Gray
$psResult = Invoke-RestMethod -Uri "http://localhost:11434/api/ps" -Method Get -TimeoutSec 3
if ($psResult -and $psResult.models) {
    foreach ($m in $psResult.models) {
        Write-Host "  unloading: $($m.name)..." -ForegroundColor Gray
        $body = @{ model = $m.name; keep_alive = 0 } | ConvertTo-Json
        Invoke-RestMethod -Uri "http://localhost:11434/api/generate" -Method Post -Body $body -TimeoutSec 5 | Out-Null
    }
    Write-Host "  done" -ForegroundColor Green
}
else {
    Write-Host "  no models running" -ForegroundColor Green
}

# 更新 settings.json
Write-Host "[2/2] Updating Pi settings..." -ForegroundColor Gray
$currentSettings.defaultModel = $modelId
$currentSettings | ConvertTo-Json | Set-Content -Path $settingsPath -Encoding UTF8
Write-Host "  defaultModel -> $modelId" -ForegroundColor Green

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Green
Write-Host ""
Write-Host "Start Pi:" -ForegroundColor Cyan
Write-Host "  .\pi-test.ps1 --tools write,read -ne -a -e .pi/extensions/show-tool-calls.ts" -ForegroundColor White

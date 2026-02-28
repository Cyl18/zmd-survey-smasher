# zmd-survey-smasher

自动填写终末地问卷的工具。通过 mitmproxy 拦截 `survey.hypergryph.com` 的 HTML 响应并注入 JS，由本地 WebSocket 服务器提供答题逻辑，实现问卷全自动填写与提交。

---

## 运行原理

```
终末地客户端（游戏内浏览器）
    │  HTTP/S 经由系统代理
    ▼
mitmproxy（127.0.0.1:<proxy_port>）
    │  拦截 survey.hypergryph.com 的 HTML 响应
    │  将注入脚本（含实际 WS 端口）插入 </body> 前
    ▼
注入的 JS（在页面内运行）
    │  检测页面类型，提取选项文本与外层 HTML
    │  向 WS 服务器发送 query
    │  接收 JS 代码字符串 → eval() 执行
    │  执行 DOM 点击 + 点击 下一页 / 提交
    │  如出现"您尚未答完此题"则随机补选并重试
    ▲
    │  WebSocket  ws://127.0.0.1:<random_port>
    ▼
WS 答题服务器（asyncio，端口由 OS 随机分配）
    │  接收页面 payload
    │  运行 AnswerStrategy，生成 JS 代码字符串
    │  返回 {"type":"eval","code":"<JS>"}
    ▼
PyQt6 GUI（主线程）
    │  启动 / 停止代理与 WS 服务器
    │  安装 CA 证书
    │  日志窗口
    └─ 退出时自动清除系统代理
```

## 支持的页面类型

| 类型 | 检测方式 | 点击逻辑 |
|------|---------|---------|
| **协议同意页**（agreement） | 页面含 `input[type="checkbox"]` 且正文包含"我已阅读" | 勾选复选框，再点击"下一页" |
| **按钮组**（button_groups） | 存在 parent 内有 ≥2 个 `<button>` 的题组 | 每组点击倒数第二个按钮，全部完成后点击"下一页"/"提交" |
| **div 选项**（div_options） | 容器 div 有 3–7 个符合图标+文字子结构的子 div | 点击倒数第二个子 div，再点击"下一页"/"提交" |

---

## 环境要求

- Windows（依赖 `winreg` 写系统代理）
- Python 3.12（通过 [uv](https://github.com/astral-sh/uv) 管理）

---

## 安装与运行

### 方式一：直接运行（需安装 uv）

```bash
# 克隆仓库
git clone https://github.com/yourname/zmd-survey-smasher
cd zmd-survey-smasher

# 安装依赖（uv 自动创建虚拟环境）
uv sync

# 启动 GUI
uv run src/main.py
```

### 方式二：使用打包好的 exe

从 Releases 页面下载 `zmd-survey-smasher.zip`，解压后运行 `zmd-survey-smasher.exe`，**不需要**安装 Python。

---

## 使用说明

1. **安装 CA 证书**（仅首次使用）  
   点击"安装 CA 证书"按钮，弹窗确认后证书自动写入 Windows 用户证书存储。  
   > 原理：mitmproxy 需要用自签名 CA 对 HTTPS 流量进行中间人解密。

2. **关闭游戏，点击"▶ 启动"**
   程序将：
   - **自动清理游戏浏览器缓存**（`%LOCALAPPDATA%\PlatformProcess\*`）
     若清理失败，日志会显示 `⚠ 缓存清理失败`，说明游戏仍在运行并锁定缓存文件——请先完全关闭游戏后再点击启动。
   - 随机分配 WS 端口并启动答题服务器
   - 在指定端口（默认自动分配）启动 mitmproxy
   - 将 Windows 系统代理设置为 `127.0.0.1:<proxy_port>`
   - 日志栏显示 `WS server on :<port>` 和 `Proxy on :<port>`

3. **打开游戏，正常进入问卷**  
   游戏内浏览器使用系统代理，流量经由 mitmproxy，注入脚本后自动完成答题与翻页/提交。  
   > ⚠️ 若问卷在启动前已打开，游戏浏览器可能使用未经过代理的旧连接，脚本不会被注入。请在游戏内**刷新/重新进入**问卷页面，让流量重新经由代理。

4. **停止**  
   点击"■ 停止"，程序清除系统代理并关闭 mitmproxy 和 WS 服务器。关闭窗口也会自动停止。

### 调试模式

勾选"调试：仅下一页（不提交）"后启动——工具只会点"下一页"而不会最终点击"提交"，方便在不实际提交的情况下测试流程。运行期间该选项置灰。

### 代理端口

默认设为 `0`（自动分配空闲端口）。如需固定端口（如 `8080`），在启动前修改"代理端口"数值。

---

## 构建 exe

```bash
uv run pyinstaller build.spec
```

产物位于 `dist/zmd-survey-smasher/`，将整个目录打包分发即可（`--onedir` 模式，因 `mitmproxy_rs` 的 Rust 扩展在 `--onefile` 模式下无法可靠自解压）。

---

## 项目结构

```
zmd-survey-smasher/
├── pyproject.toml
├── build.spec               # PyInstaller 打包配置
├── PLAN.md                  # 设计文档
└── src/
    ├── main.py              # PyQt6 GUI 入口
    ├── proxy_manager.py     # mitmproxy 后台线程管理 + Windows 系统代理
    ├── ws_server.py         # asyncio WebSocket 答题服务器
    ├── strategy.py          # AnswerStrategy（规则式；可替换为 LLM 子类）
    ├── addon.py             # mitmproxy addon：HTML 拦截与 JS 注入
    ├── cert_installer.py    # certutil CA 证书安装
    ├── cache_cleaner.py     # 游戏浏览器缓存清理
    └── inject.js            # 注入到问卷页面的客户端脚本
```

2.无法识别div组
[zmd] → agreement
ce016ae9476b3fd57ac7042e41976f3f:72 [zmd] action: agreement
ce016ae9476b3fd57ac7042e41976f3f:72 [zmd] fallback 1/10
ce016ae9476b3fd57ac7042e41976f3f:72 [zmd] fallback 2/10
ce016ae9476b3fd57ac7042e41976f3f:72 [zmd] fallback 3/10
ce016ae9476b3fd57ac7042e41976f3f:72 [zmd] fallback 4/10
ce016ae9476b3fd57ac7042e41976f3f:72 [zmd] fallback 5/10
ce016ae9476b3fd57ac7042e41976f3f:72 [zmd] fallback 6/10
ce016ae9476b3fd57ac7042e41976f3f:72 [zmd] fallback 7/10
ce016ae9476b3fd57ac7042e41976f3f:72 [zmd] fallback 8/10
ce016ae9476b3fd57ac7042e41976f3f:72 [zmd] fallback 9/10
ce016ae9476b3fd57ac7042e41976f3f:72 [zmd] fallback 10/10
ce016ae9476b3fd57ac7042e41976f3f:72 [zmd] fallback exhausted
ce016ae9476b3fd57ac7042e41976f3f:72 [zmd] page: 1 btns, 19 cb, 0 btnGrp, 0 divGrp
ce016ae9476b3fd57ac7042e41976f3f:72 [zmd] ⚠ unknown page type
ce016ae9476b3fd57ac7042e41976f3f:72 [zmd] page: 1 btns, 19 cb, 0 btnGrp, 0 divGrp
ce016ae9476b3fd57ac7042e41976f3f:72 [zmd] ⚠ unknown page type
ce016ae9476b3fd57ac7042e41976f3f:72 [zmd] page: 1 btns, 19 cb, 0 btnGrp, 0 divGrp
ce016ae9476b3fd57ac7042e41976f3f:72 [zmd] ⚠ unknown page type

会无限刷log卡cpu尝试，根本没有走fallback路径（随机乱点）
这个的结构是
div (root)
├─ div
│  └─ div
│     └─ div
│        └─ div [leaf]
├─ div
│  └─ div
│     ├─ ...（大量类似深层嵌套的分支，每个终点都是 div [leaf]）...
│     └─ div
│        └─ div
│           └─ div [leaf] 终点有文字 类似<div>abcd</div>
├─ div
│  └─ button 下一步
│     └─ div
│        ├─ div [button-inner-1]
│        └─ div [button-inner-2]
├─ div
└─ div
最好可以改的robust fault tolerant一点





根 div
├── div①  (空)
├── div②  (主内容区)
│   ├── div (头部区域)
│   │   └── div > div (标题)
│   └── div (问卷体)
│       ├── div (题目列表)
│       │   ├── div (进度指示器 - 5个小圆点)
│       │   ├── **题组1**
│       │   └── **题组2**
│       └── div (空)
├── div③  (提交按钮区)
│   └── **button** ← 提交按钮
├── div④  (空)
└── div⑤  (空)

题组 div
└── div
    ├── div (题目文字)
    └── div
        └── div (选项容器) ← 7个子元素
            ├── button  (选项1)  ✅ 可点 -> 内部还有div
            ├── button  (选项2)  ✅ 可点
            ├── button  (选项3)  ✅ 可点
            ├── button  (选项4)  ✅ 可点
            ├── button  (选项5)  ✅ 可点
            ├── div     (分隔/装饰) ❌ 跳过
            └── button  (选项6 - "其他"选项，有输入框) ✅ 可点

这种结构目前无法识别 最好可以改的robust fault tolerant一点 通用一点
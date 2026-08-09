# 部署到 Render（云端托管页面 + AI 转发代理）

目标：把 `server.js` 部署成一个云端 Web 服务，它**同时托管页面和 AI 代理**，同一个地址既能打开工作台、又能调用 AI。

两种分享模式（部署步骤完全一样，区别只在「是否填密钥」）：

- **方式 A（推荐 · 公开分享）**：部署时**不填任何密钥**。朋友打开链接，用自己的 Key 走「本地代理」转发。你零成本、不暴露自己的 Key，商汤 / DeepSeek 等全部可用。
- **方式 B（小圈子 · 零设置）**：部署时把你的 Key 填进环境变量，朋友打开即用、什么都不用填，但调用都扣你的余额，不适合陌生人。

下面先讲方式 A（你要的），再附方式 B。

---

## 方式 A：公开分享 + 朋友自带 Key（推荐，商汤可用，你零成本）

适用：把链接发给别人，对方**用自己的 AI Key** 来用（商汤 / DeepSeek / OpenAI 等所有 OpenAI 兼容模型都能用），你不用付钱、也不用暴露自己的 Key。

原理：`server.js` 部署后变成公网转发代理。它只负责把浏览器发来的「模型请求」转发给真实 AI 厂商——转发发生在**服务器侧**，绕开了浏览器对商汤的 CORS 限制。朋友的 Key 只存在他们自己浏览器里，经你的服务器转发，**服务器不存储任何 Key**。

### 你（部署者）的步骤
1. 注册 Render 免费账号（可用 GitHub 登录）：https://render.com
2. 把本项目推到你的 GitHub 仓库（见文末「本地仓库 → GitHub」）
3. Render 后台 → **New** → **Blueprint** → 选择该仓库，自动读取 `render.yaml`
4. **关键：Environment 里所有密钥变量全部留空（不要填！）** —— 这就是方式 A
5. 点 **Deploy**，等 1~2 分钟，得到地址如 `https://ai-teaching-workbench.onrender.com`
6. 把地址发给朋友

### 朋友怎么用（你直接把这段发给他们）
1. 打开你发的链接
2. 右上角 **⚙️ 设置** → API 设置
3. 保持「通过本地代理调用」勾选（默认就开），选预设（**商汤Token** / **DeepSeek** 等），**填你自己的 Key**
4. 点「测试连接」→ ✅ 连接成功，开始使用

注意事项：
- 朋友**不要**开「☁️ 云端安全代理」——那个模式要靠服务器存着 Key，方式 A 没设，会报“服务器未配置密钥”。
- 服务器只做转发，朋友用自己的 Key，你完全不花钱。
- 免费档会休眠 / 冷启动，首屏慢几秒属正常。

验证（方式 A）：访问 `https://你的地址/api/providers` 应返回各服务商 `configured: false`（因为没设密钥）；朋友在自己浏览器填 Key 后测试连接成功，即代表一切正常。

### 方式 A 免 Git 版：直接用 Railway 部署文件夹
如果你不想装 Git / 不用 GitHub，可以用 **Railway** 直接把项目文件夹传上云（不需要 Git 仓库，也不用 Xcode 命令行工具）：

1. 注册 Railway：https://railway.app （可用 GitHub 登录）
2. 在项目目录终端执行登录（会打开浏览器授权）：
   ```bash
   npx @railway/cli login
   ```
3. 初始化并部署（已备好 `railway.json`）：
   ```bash
   npx @railway/cli init --name ai-teaching-workbench
   npx @railway/cli up
   ```
   或一键运行脚本： `bash deploy-railway.sh`（前置同样是先 `npx @railway/cli login`）
4. 部署完成后分配公网域名：
   ```bash
   npx @railway/cli domain
   ```
   得到如 `https://ai-teaching-workbench.up.railway.app` 的地址
5. 把地址发给朋友（朋友设置同上方「朋友怎么用」）

> 注意：Railway 已无永久免费档，新账号有少量试用额度，超出需绑定支付方式。若你只想要完全免费，仍建议走上面的 GitHub + Render 方式。

---

## 方式一：Blueprint 一键部署（最简单）

1. 注册免费账号：https://render.com （可用 GitHub 登录）
2. 把本项目推到你的 GitHub 仓库（或直接用 Render 的 "Deploy to Render" 上传文件夹）
3. 在 Render 后台 → **New** → **Blueprint** → 选择该仓库
4. Render 会读取 `render.yaml`，自动建好 Web 服务
5. 在 **Environment** 里：**方式 A 全部留空；方式 B 才填你要用的 AI 密钥**（如 `SENSENOVA_TOKEN_KEY`、`OPENROUTER_KEY` 等，只填要用的即可）
6. 点 **Deploy**，等 1~2 分钟，得到地址如 `https://ai-teaching-workbench.onrender.com`
7. 浏览器打开该地址 → ⚙️ → 勾选 **「☁️ 云端安全代理」** → 选服务商预设 → 填模型 → 点「测试连接」→ 应显示「✅ 连接成功」
8. 「云端代理地址」**留空**即可（因为页面和代理同源）

> 免费档说明：Render 免费 Web 服务在闲置约 15 分钟后会休眠，再次访问需冷启动约 30~50 秒（首屏稍慢，之后正常）。
> 免费档可能需要绑定信用卡做验证（不扣费）。

---

## 方式二：手动 New Web Service

1. Render 后台 → **New** → **Web Service**
2. 连接仓库
3. 设置：
   - **Runtime**: Node
   - **Build Command**: `echo no build`
   - **Start Command**: `node server.js`
   - **Plan**: Free
4. 在 **Environment** 里加密钥环境变量（同上）
5. **Create Web Service**

---

## 环境变量对照表（填你需要的即可）

| 变量名 | 对应服务商 | 模型示例 |
|--------|-----------|----------|
| `SENSENOVA_KEY` | 商汤日日新（大装置） | `SenseChat-5` |
| `SENSENOVA_TOKEN_KEY` | 商汤 Token（开放平台） | `sensenova-6.7-flash-lite` |
| `DEEPSEEK_KEY` | DeepSeek | `deepseek-chat` |
| `OPENROUTER_KEY` | OpenRouter（几百种模型） | `google/gemini-2.0-flash-001` |
| `GEMINI_KEY` | Google Gemini | `gemini-2.0-flash` |
| `OPENAI_KEY` | OpenAI | `gpt-4o` |
| `MOONSHOT_KEY` | Moonshot | `moonshot-v1-8k` |
| `QWEN_KEY` | 通义千问 | `qwen-plus` |
| `GLM_KEY` | 智谱 GLM | `glm-4-flash` |

---

## 验证部署成功

部署后访问 `https://你的地址/api/providers`，应返回 JSON 并列出各服务商 `configured: true/false`
（你填了密钥的会是 `true`）。

在页面 ⚙️ 里选了某个预设、点「测试连接」显示「✅ 连接成功」，即代表云端 AI 已独立可用。

---

## 本地运行 / 调试

```bash
# 本地启动（默认 8080）
node server.js

# 带密钥环境变量启动（provider 模式才会真正调用 AI）
SENSENOVA_TOKEN_KEY=你的key node server.js

# 指定端口（Render 会自动用 PORT 环境变量）
PORT=3000 node server.js
```

本地访问：http://localhost:8080/index.html

---

## 本地仓库推送到 GitHub（首次部署需要）

本项目的 Git 仓库已由本地初始化并提交。把代码推到 GitHub 后才能被 Render 拉取：

1. 在 GitHub 网页（https://github.com/new）新建一个**空仓库**（不要勾选 README / .gitignore），得到仓库地址，例如 `https://github.com/你的名/ai-teaching-workbench.git`
2. 在终端执行（项目目录已就绪）：
   ```bash
   git remote add origin https://github.com/你的名/ai-teaching-workbench.git
   git branch -M main
   git push -u origin main
   ```
   > 首次 push 会要求 GitHub 登录（浏览器授权或填 Personal Access Token），按提示操作即可。
3. 回到 Render → New → Blueprint → 连接这个 GitHub 仓库 → 按「方式 A」步骤部署。

如果你不想用 GitHub，也可以改用 **Railway**（`railway up` 直接传文件夹、免 Git），但需要另写一份 `railway.json` 配置——需要的话告诉我。


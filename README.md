# Evolve Desk

一个从真实日常开始、由内置 Agent 协助行动，并能在审阅后持续改写自身源码的个人工作台。

项目主页：[github.com/Tabriage/EvolveDesk](https://github.com/Tabriage/EvolveDesk)

[![CI](https://github.com/Tabriage/EvolveDesk/actions/workflows/ci.yml/badge.svg)](https://github.com/Tabriage/EvolveDesk/actions/workflows/ci.yml)

## 本地运行

```bash
pnpm install
pnpm dev
```

打开 `http://localhost:3000`，在右上角连接设置里输入本地 OpenAI 兼容服务地址和密钥。密钥只保留在当前页面内存中，不写入代码或浏览器存储。

`pnpm dev` 会同时启动工作台和只监听 `127.0.0.1:4242` 的源码进化沙箱。

视频导入与画面抽取需要本机安装 `yt-dlp >= 2026.03.17` 和 `ffmpeg >= 6.1`；无字幕时的本地转录还需要 `whisper-cpp`，画面文字识别可选用 Tesseract。macOS 可以使用：

```bash
brew install yt-dlp ffmpeg whisper-cpp tesseract tesseract-lang
```

首次使用本地转录时，在视频工作台中明确点击“下载多语言模型”。应用会从 whisper.cpp 官方模型仓库下载约 142 MiB 的 `base` 模型，校验大小与 SHA 后保存到 Git 忽略的 `.evolve/models/`；不会在启动时自动下载。

## 当前产品闭环

- **今日**：设置唯一焦点、添加和完成任务、建立轻量习惯。
- **我的路线**：把创作、学习、练习或管理目标配置成 1–6 个顺序阶段；每个阶段都有结果、完成证据和可接入动作。路线 Agent 先生成可编辑蓝图，用户确认后才能保存，并可把当前动作明确接入今日任务或习惯。
- **个人业务台**：把反复记录的对象配置成字段与状态流程，同一套底座可承载视频选题、学习材料、练习记录、订单等场景。支持内容、学习和订单模板，也可由 Agent 生成可编辑结构；记录可在看板/表格中推进并转成今日任务，业务台还可连接个人路线。
- **创作工作室**：保存创作定位与真实观察信号，从视频总结、知识卡或信号中选择证据，生成每日灵感或有来源的二创方案；选题可逐步完成制作动作、接入今日任务或业务台，发布后再用真实指标和观察区分事实、低置信度假设与下一次单变量实验。
- **统一收件箱**：先保存想法与链接，再决定是否转为任务。
- **视频总结与外部原文件索引**：支持 B站、YouTube、小红书、抖音以及不超过 500MB 的本地音视频；优先提取平台字幕，没有字幕时可用本机 Whisper 转录，也允许粘贴已有文本。支持 File System Access API 的浏览器可由用户选择“保留外部索引”：原文件仍留在用户目录，只把文件句柄、元数据与首尾采样指纹放入独立本地库；维护台可扫描失效、权限、内容变化和孤立索引，批量重新定位唯一匹配的原文件。用户还可把所选文件加入当前页面的完整哈希队列：队列按 4 MiB 分块读取、块间让出主线程并可暂停恢复；完成后只凭文件大小和完整 SHA-256 形成只读重复内容报告，不自动清理或推荐删除。重复报告可导出 SHA-256 封签的无内容审计摘要：它排除文件名、路径、来源 ID、采样指纹与原始完整哈希，只保留计数、组内字节量和匿名组集合封签，供另一台设备严格只读核对本机报告。以后打开旧总结时可再次授权读取、核对指纹并建立短期处理副本。本机 FFmpeg 可按字幕时间分布抽取最多 8 帧，Tesseract 识别中英文画面文字；支持图片的本地模型还能逐帧核对界面、对象、读字与不确定性。总结包含一句话结论、时间戳章节、画面直接支持的发现、核心概念、创作拆解、知识卡片和建议任务。
- **时间与视觉证据轨**：字幕在浏览器中分段并可搜索，画面以带片孔的证据底片核对；针对单个视频提问时只挑选最多 12 段相关字幕与 4 帧相关画面发送给本机模型，回答引用会重新匹配真实 S/F 编号，并可保存为知识问答或生成任务。
- **知识证据台**：搜索并选择最多 12 张本地知识卡，向本机模型提问；回答必须保留有效卡片引用，资料不足时明确列出缺口，并可由用户确认保存问答或生成任务。不同来源之间的共同标签与重复概念会形成可解释的待求证关联。
- **多来源学习专题**：从真实视频总结和知识卡中选择最多 16 条资料，先离线保存专题资料架，再由本地 Agent 生成中心理解、2–8 个有据节点、支持/补充/冲突/依赖关系和待求证问题。每个节点的来源都会在服务端重新绑定；新增资料或修改学习问题后，旧脉络保持不变，新版的资料变化、中心理解、保留/改写/移除节点和风险提示必须先审阅，明确采用后才保存。
- **证据星图**：在浏览器本地根据真实对象标识，连接视频、关键帧、知识卡、学习专题与复习题。用户可以围绕任一节点展开两层关系、反向追到最近视频或画面来源、区分明确引用实线与文本关联点线，并把悬空或待核对关系加入今日任务。
- **记忆复习**：从最多 12 张真实知识卡生成可编辑的主动回忆题与选择题，也可完全手动制卡；每题保留来源，回答后由用户以“忘了 / 吃力 / 记住 / 很稳”评分，系统透明计算下一次出现时间。到期队列可以直接加入今日任务，复习次数进入周回顾；一次答对不会被包装成已经掌握。
- **周回顾**：按本地自然周计算七天事实轨迹，区分完成、输入、习惯、视频关键帧与知识产物；本地 Agent 只能依据这份快照提炼成果、可能摩擦、知识连接和下周唯一方向，保存后可把建议动作加入任务。
- **行动 Agent**：读取有限的工作台快照，把自然语言目标转换为结构化动作清单，也能选择真实存在的路线动作、业务记录和创作选题并接入今日任务；只有用户确认后才写入本地状态。
- **自省记忆**：记录任务完成、输入整理和已经确认的 Agent 动作，解释工作台如何形成。
- **数据迁移与兼容证明**：把 `localStorage` 工作台状态与 `IndexedDB` 字幕、采样帧封装成一份带 SHA-256 内层校验的 JSON 迁移卷。默认可再用保护口令封成 AES-256-GCM 加密卷，标准明文卷仍可选；导入加密卷时先显示源工作台版本到当前版本的迁移路径，并逐类列出会被规范化的对象、会忽略的不兼容对象、修复的悬空引用和丢弃的画面，再按稳定对象 ID 预览新增、改写与移除。源文件始终保持不变，二次确认后才写入迁移后的内存结果，并可在刷新页面前一步撤回整次恢复。
- **加密同步、设备撤销、所有权恢复与冲突合并**：每台设备在独立 `IndexedDB` 中生成不可导出的 ECDH 密钥协商私钥与 ECDSA 签名私钥。目标设备先生成 24 小时授权请求；同步空间的创建设备读取请求、当面核对完整指纹并明确确认后，才生成只能由目标私钥解锁的授权回执。撤销设备会签名空间轮换记录、生成全新的随机空间密钥与空间 ID，并把旧世代置为只读；未撤销设备也必须用原身份重新申请授权。创建设备还可预先下载口令加密的离线恢复材料，并用实际离线材料与同步包完成无副作用演练；恢复封条会按空间世代、授权清单、当前版本头、90 天演练周期与 180 天维护复核周期给出替换清单，还可导出不含秘密、由原创建设备签发的 v2 审计摘要供另一台设备只读核对。读取端会分开显示 SHA-256 完整性、ECDSA 签名有效性和签发者是否属于本机保存的对应空间原创所有者，仍兼容未签名 v1。真正接任时仍必须同时验证恢复材料和旧空间加密同步包，先在内存预演，再经明确确认轮换到新所有者、新空间 ID 和新密钥，并下载供旧成员独立验签的所有权迁移记录。工作台仍复用迁移卷作为内层载荷，再封成带父版本、AES-256-GCM 认证加密和设备签名的同步包。文件适配器可以经 U 盘或用户选择的目录搬运密文；远端连接向导提供通用 HTTP 网关、Cloudflare R2 与 Amazon S3 三种配方，浏览器可用 SigV4 签署 GET/PUT，并生成限定当前 Origin、暴露 ETag 的最小 CORS 配方。三种配方都保留首次 `If-None-Match: *`、后续强 ETag `If-Match` 的同一条件写入契约，只搬运同一种不透明密文。短期凭据护照会显示有效、5 分钟警戒、30 秒停发、到期和期限未知状态；权限剪票把供应商、当前单一对象、GET/PUT 与 TTL 固定成可重算规范，拒绝 LIST、DELETE、前缀和通配符。用户可显式调用可信 broker 续签当前单一对象，也可运行仅监听回环地址的开源代理模板；目标或空间变化时 broker 凭据立即从内存清除。连接诊断可以导出 SHA-256 封签摘要，端点、对象、Access Key、版本与 ETag 不直接披露，只保留可比对摘要；Secret、Session Token 和 broker Token 不进入文件。浏览器最多保留每个空间最近 4 份加密同步包作为版本证据。导入分叉包且能找到共同父版本时，系统按稳定对象 ID 做三方预览：单边对象变化自动合入；同一对象的不同普通字段会递归拼合，同字段分歧和删除对修改必须由用户明确选择。合并校样台可按分类、字段路径、状态和对象缩小范围，把当前可见的未决项明确批量设为本机或迁入，并撤回最近一次批量操作；它不会覆盖已有选择或推荐方向。写入前需要二次确认，本次可撤回，并优先生成不含字段值、由本机不可导出 ECDSA 私钥签发的 v3 决策回执；离线校验台会分别核对 SHA-256 完整性、设备签名和该设备是否属于回执绑定空间的本机授权清单，仍兼容未签名 v2 与无封签 v1。下一份同步包会认证两条已合并父版本线。整体迁入仍是单独的危险选择。
- **进化实验室**：在白名单源码内生成差异，逐文件审阅后只在临时 worktree 写入；ESLint 与 TypeScript 静态检查通过才创建独立提案分支和提交。用户再次确认后才能推送分支并开启 GitHub 草稿 PR，当前工作分支不会承载未采用的 Agent 代码。

任务、收件箱、习惯、个人路线、个人业务台及记录、创作定位、观察信号、选题、内容复盘、视频总结、视觉证据元数据、知识卡片、学习专题、复习卡与复习记录、已保存问答、周回顾和活动记录保存在浏览器 `localStorage`；体积更大的字幕与关键帧图片单独保存在浏览器 `IndexedDB`；可选外部媒体文件句柄保存在第三座独立 `IndexedDB`，设备身份私钥、同步空间密钥和不含秘密的恢复维护回执则在另一座密钥库。当前不依赖账户或云端数据库，远端对象地址、Bearer 令牌、SigV4 访问凭据、到期时间、续签服务地址与 Token 都不会持久化。即使不连接模型或远端存储，也能配置路线与业务台、保存专题资料架、本机抽帧与 OCR、手动制卡、完成间隔复习、记录创作信号和发布结果，并完整使用日常工作台、字幕搜索、加密迁移、文件同步传输与周度事实轨迹。

## 短期存储凭据续签契约

工作台不会直接调用需要父级 R2 API Token 或长期 AWS 密钥的签发接口。用户配置的可信续签服务收到以下 JSON；服务必须在服务端把权限收窄到当前桶和对象，且只签发短期 Session Token：

```json
{
  "format": "evolve-desk-storage-credential-request",
  "version": 1,
  "provider": "cloudflare-r2",
  "scope": {
    "accountId": "<R2_ACCOUNT_ID>",
    "bucket": "private-sync",
    "objectKey": "evolve-desk/<CHANNEL_ID>.json",
    "region": "auto",
    "operations": ["GetObject", "PutObject"]
  },
  "ttlSeconds": 900
}
```

推荐返回规范化结构：

```json
{
  "credentials": {
    "accessKeyId": "<TEMPORARY_ACCESS_KEY_ID>",
    "secretAccessKey": "<TEMPORARY_SECRET_ACCESS_KEY>",
    "sessionToken": "<TEMPORARY_SESSION_TOKEN>",
    "expiresAt": "2026-08-21T10:15:00.000Z"
  }
}
```

读取端也兼容 Cloudflare 的 `{ "success": true, "result": { ... } }` 响应（到期时间按本次请求的 `ttlSeconds` 计算），以及 AWS STS/Cognito 的 `{ "Credentials": { "AccessKeyId", "SecretAccessKey" 或 "SecretKey", "SessionToken", "Expiration" } }`。续签 URL 只接受 HTTPS，本机回环地址可用 HTTP；拒绝 URL 查询参数、内嵌凭据、跨站重定向、超过 64 KiB 的响应、缺少 Session Token、剩余不足 30 秒或超过 7 天的结果。broker 的可选 Bearer 只放在请求头和当前页面内存中。

### 可选本地凭据代理

仓库包含一个需要手动启动的参考代理。它固定监听 `127.0.0.1:4243`，默认只接受 `http://localhost:3000`，不会随 `pnpm dev` 自动启动，也不会读取或复用工作台中的模型密钥：

```bash
EVOLVE_STORAGE_BROKER_TOKEN='<CHOOSE_A_LOCAL_BEARER>' \
pnpm broker:storage
```

然后在远端连接向导中选择 R2 或 S3、补全单一对象地址，保留默认代理 URL `http://127.0.0.1:4243/credentials`，填入相同 Bearer 并点击“检查代理”。`GET /health` 只报告签发器是否启用，不返回凭据。

启用 R2 本地签发器需要把父级 S3 API 凭据只交给代理进程：

```bash
EVOLVE_R2_ACCOUNT_ID='<32_HEX_ACCOUNT_ID>' \
EVOLVE_R2_ACCESS_KEY_ID='<PARENT_R2_ACCESS_KEY_ID>' \
EVOLVE_R2_SECRET_ACCESS_KEY='<PARENT_R2_SECRET_ACCESS_KEY>' \
EVOLVE_STORAGE_BROKER_TOKEN='<CHOOSE_A_LOCAL_BEARER>' \
pnpm broker:storage
```

代理按 Cloudflare 的本地签名规范生成 HS256 JWT：`actions` 精确为 `GetObject` / `PutObject`，`paths.objectPaths` 只有当前对象；临时 Secret 是 JWT 的 SHA-256，Session Token 是 `jwt/<SIGNED_JWT>` 的 Base64。父级 R2 Secret 只留在 Node 进程环境中，绝不能放进浏览器、`.env` 提交或权限票据。

启用 AWS STS 签发器需要一个可被当前父级身份 `sts:AssumeRole` 的标准 `aws` partition 角色（当前模板暂不生成 `aws-cn` / `aws-us-gov` ARN）：

```bash
EVOLVE_AWS_ROLE_ARN='arn:aws:iam::<ACCOUNT_ID>:role/<ROLE_NAME>' \
EVOLVE_AWS_REGION='ap-southeast-1' \
AWS_ACCESS_KEY_ID='<PARENT_AWS_ACCESS_KEY_ID>' \
AWS_SECRET_ACCESS_KEY='<PARENT_AWS_SECRET_ACCESS_KEY>' \
EVOLVE_STORAGE_BROKER_TOKEN='<CHOOSE_A_LOCAL_BEARER>' \
pnpm broker:storage
```

父级身份本身也可以是临时凭据，此时另设 `AWS_SESSION_TOKEN`。角色需要单独配置正确的信任策略和权限上限；代理在每次 `AssumeRole` 中附加只允许当前对象 `s3:GetObject` / `s3:PutObject` 的 inline session policy。最终会话权限是角色权限与会话策略的交集，inline policy 不能扩大角色权限。

可选配置包括 `EVOLVE_STORAGE_BROKER_ORIGIN`、`EVOLVE_STORAGE_BROKER_PORT`、`EVOLVE_AWS_EXTERNAL_ID`。代理拒绝非回环连接、伪造 Host、非白名单 Origin、错误 Bearer、非 JSON、超过 64 KiB 的请求、额外字段、范围前缀、策略通配符和额外操作。AWS TTL 为 900–43200 秒，R2 TTL 为 300–604800 秒。

界面复制的 R2 “最小权限策略”是临时凭据 JWT 的范围 claims；AWS 输出则是 STS inline session policy。严格等价核对能证明本次请求和生成策略没有扩大到别的对象或操作，但不能证明父级 R2 Key、AWS 角色策略、桶策略或组织 SCP 本身配置正确。

实现依据可对照 [Cloudflare R2 临时凭据](https://developers.cloudflare.com/r2/api/s3/temporary-credentials/)、[Cloudflare 本地签名示例](https://developers.cloudflare.com/r2/examples/authenticate-r2-temp-credentials/)、[AWS STS AssumeRole](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html) 与 [Amazon S3 策略动作映射](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-with-s3-policy-actions.html)。

### 部署凭据代理

Cloudflare 模板位于 `deploy/storage-broker/cloudflare/`。它使用 Workers Web Crypto 实现与本地代理等价的 R2 HS256 签发，不启用 Node.js compatibility；`wrangler.jsonc` 声明五个必需 secret，部署时不会把值写入配置文件：

```bash
pnpm exec wrangler secret put ALLOWED_ORIGIN --config deploy/storage-broker/cloudflare/wrangler.jsonc
pnpm exec wrangler secret put BROKER_TOKEN --config deploy/storage-broker/cloudflare/wrangler.jsonc
pnpm exec wrangler secret put R2_ACCOUNT_ID --config deploy/storage-broker/cloudflare/wrangler.jsonc
pnpm exec wrangler secret put R2_ACCESS_KEY_ID --config deploy/storage-broker/cloudflare/wrangler.jsonc
pnpm exec wrangler secret put R2_SECRET_ACCESS_KEY --config deploy/storage-broker/cloudflare/wrangler.jsonc
pnpm exec wrangler deploy --config deploy/storage-broker/cloudflare/wrangler.jsonc
```

`ALLOWED_ORIGIN` 必须是实际工作台的精确 HTTPS Origin；`BROKER_TOKEN` 至少 16 字符并应独立生成。不要创建或提交 `.dev.vars`，仓库已显式忽略它。

如果 GitHub 仓库侧不能保存长期 Cloudflare 部署 Token，按 [`deploy/storage-broker/cloudflare/WORKERS_BUILDS.md`](deploy/storage-broker/cloudflare/WORKERS_BUILDS.md) 把该 Worker 接到 Cloudflare Workers Builds：GitHub App 只授权本仓库，生产分支固定为 `main`，根目录为 `/`，部署命令使用仓库锁定的 pnpm 与 Wrangler。Cloudflare 会在 GitHub 提交上回写 Check Run 与 Build ID。

这条 Cloudflare 路径不是 OIDC。官方外部 GitHub Actions 路径仍要求 `CLOUDFLARE_API_TOKEN`；Workers Builds 则使用保存在 Cloudflare 一侧的用户 API Token，自动生成 Token 的默认权限还可能覆盖 Workers、KV、R2 和 Routes。仓库无需持有它不等于凭据已经短期化：应改用独立、单账号、尽量只含 Workers Scripts Edit 的 Token，并连同五个运行时 secret 定期轮换。依据见 [Workers Builds Git 集成](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/)、[Build 配置与 Token 边界](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/) 和 [外部 GitHub Actions 认证要求](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)。

AWS 模板位于 `deploy/storage-broker/aws-lambda/`，使用 Node.js 22、Lambda Function URL payload v2.0 和 Makefile 白名单打包。模板不会接收静态 AWS Access Key：Lambda 自动注入执行角色的短期凭据，生成的执行策略只能对参数指定的角色调用 `sts:AssumeRole`。需要安装 AWS SAM CLI 后执行：

```bash
sam validate --template-file deploy/storage-broker/aws-lambda/template.yaml
sam build --template-file deploy/storage-broker/aws-lambda/template.yaml
sam deploy --guided
```

`AllowedOrigin`、`BrokerToken`、`TargetRoleArn` 与 `SyncRegion` 都需要在引导部署中明确填写。Function URL 使用 `NONE` 以允许浏览器调用，因此它是公开互联网端点；应用层仍强制独立 Bearer、精确 Origin、固定 `/health` / `/credentials` 路径、64 KiB 请求上限和最多 5 个并发执行环境。公开生产端点仍应结合预算告警、日志脱敏、限流，以及需要时改用 API Gateway/WAF。浏览器不能直接使用 `AWS_IAM` Function URL，因为那会再次要求它持有可签名 AWS 身份。

仓库还提供手动触发的 `Deploy AWS storage broker` 工作流。它只授予 `contents: read`、`id-token: write` 与 `attestations: write`，用 GitHub OIDC JWT 换取一小时以内的 AWS 会话，不保存 AWS Access Key。首次启用需要先在 AWS 添加 `https://token.actions.githubusercontent.com` OIDC Provider，再部署 `deploy/storage-broker/aws-lambda/github-oidc-role-template.yaml`。信任策略同时固定 `aud=sts.amazonaws.com`、当前仓库不可变 owner/repository ID 和 `storage-broker-production` Environment，不使用仓库通配符。为 Environment 配置审批者和只允许 `main` 的部署分支规则。

在 GitHub Environment `storage-broker-production` 中配置：

- Variables：`EVOLVE_AWS_REGION`、`EVOLVE_AWS_DEPLOY_ROLE_ARN`、`EVOLVE_AWS_ARTIFACT_BUCKET`、`EVOLVE_AWS_STACK_NAME`、`EVOLVE_AWS_BROKER_TARGET_ROLE_ARN`、`EVOLVE_AWS_BROKER_FUNCTION_NAME`、`EVOLVE_AWS_BROKER_RUNTIME_ROLE_NAME`、`EVOLVE_WORKBENCH_ORIGIN`。
- Secrets：32–256 字符、只含字母数字和 `_` / `-` 的随机 `EVOLVE_BROKER_TOKEN`；跨账号目标角色需要时再配置 `EVOLVE_AWS_EXTERNAL_ID`。

工作流锁定 pnpm、Node.js、SAM CLI 和每个 Action 的完整提交 SHA，SAM 只打包 Makefile 白名单文件。CloudFormation 发布后，`live` Alias 指向一个不可变 Lambda Version；流水线读取该版本的 `CodeSha256`、Function ARN 和实际 Function URL，生成闭集部署回执，并用 GitHub Artifact Attestation 签发来源证明。GitHub 官方说明见 [AWS OIDC](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws) 与 [Artifact Attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)。

部署后，在已经提交且工作树干净的源码上生成无秘密发布封签：

```bash
pnpm --silent broker:release-check -- \
  --target cloudflare-worker-r2 \
  --endpoint https://evolve-desk-r2-credential-broker.example.workers.dev \
  --origin https://desk.example \
  > /tmp/evolve-broker-release-proof.json
```

AWS 使用 `--target aws-lambda-s3`，`--endpoint` 必须是实际 `https://<id>.lambda-url.<region>.on.aws` Origin。命令拒绝未提交或有改动的工作树，并联网要求当前提交与 GitHub origin 同名分支头一致；随后封签 GitHub origin、40 位提交、分支、远端头核对结果、代理/工作台 Origin、公开端点安全契约，以及目标运行时每一个实际文件的 SHA-256。它不读取或导出任何 secret 值。把文件交给工作台“核对发布封签”后，只有供应商、代理 Origin、当前页面 Origin、字段闭集与整体 SHA-256 全部一致才显示 `SOURCE SEALED`。

普通发布封签是可重复核对的来源与配置清单，不是设备签名、GitHub Attestation 或云平台部署证明：它不能单独证明线上端点确实运行这些字节，也不能证明仓库作者身份。AWS OIDC 流水线会额外产出 `evolve-storage-broker-deployment-proof.json`，其中嵌套普通封签，并绑定 GitHub Run、Environment、不可变 Lambda Version、Function ARN、Function URL 与 `CodeSha256`。在工作台 Amazon S3 配方中导入后，只有供应商、代理 Origin、页面 Origin 和所有闭集摘要一致才显示 `CI RECEIPT MATCH`。同一次显式导入还会在不发送 Token 的前提下读取 GitHub 公共 Run API，逐项要求仓库、Run ID/Attempt、工作流路径、提交、分支和时间窗口一致，且 `workflow_dispatch` 已以 `success` 完成；成功后显示 `RUN API ✓`，离线、限流或任一字段不一致则保留 `RUN API ?`。

部署回执自身的 SHA-256 只能检查文件内部是否被改写；工作台不会把这一点伪装成作者身份验证。下载 Actions Artifact 后先执行：

```bash
gh attestation verify evolve-storage-broker-deployment-proof.json -R Tabriage/EvolveDesk
```

验证通过再导入工作台。GitHub Attestation 证明该文件由声明的 Actions 工作流产生；它仍不能替代对 AWS 账号、OIDC Role 权限、目标 AssumeRole 信任、桶策略、当前 Alias 或公开端点防滥用措施的独立核对。Cloudflare Workers Builds 目前只回流 Check Run、Build ID 与 Dashboard Version ID，没有生成可导入的 GitHub Attestation 回执。

部署实现依据可对照 [Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/)、[Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)、[Lambda Function URL payload v2.0](https://docs.aws.amazon.com/lambda/latest/dg/urls-invocation.html)、[Function URL 访问控制](https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html)、[Lambda 运行时环境凭据](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html) 与 [AWS SAM Makefile 构建](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/building-custom-runtimes.html)。

## 当前安全边界

- 只允许连接本机 HTTP 模型服务（localhost / 127.0.0.1）。
- 路线 Agent 只能返回受 schema 约束的路线蓝图，不能直接写入状态，也不能虚构用户已有进度、能力、日期或截止时间。
- 业务台 Agent 只能返回受 schema 约束的字段与状态结构，不能创建客户、金额、日期、学习成果或其他用户记录。
- 创作 Agent 不会自行抓取或声称知道实时热点；来源二创必须引用用户选择的真实视频、知识卡或观察信号，所有引用由服务端重新匹配。内容复盘只读取用户填写的发布指标与观察，明确区分可观察事实和低置信度假设。
- 行动 Agent 只能提出 `新增任务 / 设置焦点 / 保存输入 / 新增习惯 / 激活真实路线动作 / 新增业务记录 / 推进真实业务记录 / 从业务记录创建任务 / 推进真实创作选题 / 从创作选题创建任务 / 安排真实到期复习` 十一类结构化动作；已有对象的 ID 必须来自当前有限快照。
- 视频导入器只接受四个平台的显式 HTTPS 主机，使用固定 `yt-dlp` 参数且不经过 shell；它不能执行用户提供的命令或访问任意 URL。
- 本地转录限制单个视频最长两小时、媒体最大 500MB；用户选择的文件只暂存在 Git 忽略的 `.evolve/uploads/`，转录或保存后立即删除，未完成流程的文件最长保留 24 小时，不上传第三方转录服务。
- 外部原文件索引只在用户通过浏览器文件选择器明确选择时建立，不复制媒体内容。文件句柄、名称、类型、大小、修改时间、SHA-256 采样指纹和可选完整哈希只保存在独立 `evolve-desk-external-media` IndexedDB，不进入工作台状态、迁移卷、同步包或模型请求；不支持持久文件句柄的浏览器仍使用原有临时导入。移除索引只删除浏览器句柄记录，不会移动、改名或删除磁盘原文件。
- 外部媒体采样指纹覆盖文件元数据与首尾各 64 KiB，用于发现常见的替换或改写，不等于完整文件哈希，也不能证明文件来源。完整 SHA-256 只在用户点击后以 4 MiB 分块读取不超过 500MB 的文件内容，能够补足采样没有覆盖的中段，但同样不能证明来源或真实性。哈希队列在分块间主动让出主线程，暂停只保留当前页面内存中的中间状态；刷新或关闭后未完成文件必须从头计算，不会把不完整状态持久化成成功。重新打开需要浏览器再次确认读取权限，且必须同时匹配名称、大小、修改时间和采样指纹；不一致时拒绝建立处理副本并要求用户重新核对绑定。
- 外部索引扫描只查询已有读取权限，不会为全部文件弹出授权。批量重新定位先要求元数据与采样指纹唯一匹配；只有原索引已经保存完整哈希时，才允许用完整内容匹配改名文件。候选重复、目标重复或证据不足时保持原索引不变，不猜测绑定；“孤立”只表示当前工作台已没有对应本地视频记录。重复内容报告也只接受相同文件大小和相同完整 SHA-256，不使用文件名、路径或采样指纹推断；报告不会移动或删除文件，也不会判断哪份副本应该保留。无内容审计摘要不会重新读取原文件，也不会导出可识别文件的字段；严格读取限制为 64 KiB、拒绝未声明字段并验证整体 SHA-256 封签。跨设备一致只表示统计与匿名组集合相同，不授权清理、不导入索引，也不能证明摘要来自哪台设备。匿名组集合封签是可重复的比较指纹：如果接收方已知候选文件的完整哈希、大小与副本数，仍可能据此验证猜测，因此该摘要不是秘密或不可关联的匿名凭证。
- 视觉证据最多保存 8 帧；单帧 JPEG 不超过 450 KiB。平台视频只在本机临时下载用于抽帧并立即删除；本地视频在抽帧后保留到转录、保存或主动丢弃。Tesseract OCR 是可能出错的自动识别结果，和视觉模型读字分开保存。
- 模型必须拿到至少 80 个字符的字幕证据才会总结；标题和封面不能代替字幕。字幕只发送到用户配置的本机模型服务。
- 视觉 Agent 一次最多接收用户选择的 6 帧，只允许引用服务端重新编号的 F 编号；不支持图片的模型失败时不会伪造视觉观察，本机 OCR 和图片仍然可用。
- 单视频问答最多读取本地筛选出的 12 段、18,000 个字幕字符和 4 帧画面；服务端会重新编号并过滤 S/F 引用，模型无法引用未提供的字幕或画面。
- 知识问答一次最多读取用户选中的 12 张卡片；结论引用会在服务端重新匹配真实卡片编号，无法匹配的模型引用不会进入结果。
- 制卡 Agent 一次最多读取用户选中的 12 张知识卡；每道题必须返回有效卡片编号，服务端会移除无来源或重复题目。保存时再次用当前本地知识库还原来源，模型不能伪造引用标题或链接。
- 学习专题 Agent 一次最多读取 16 条经过裁剪的视频摘要或知识卡内容，不接收完整字幕和关键帧图片；每个节点至少需要一个有效 S 编号，服务端会重新绑定来源、过滤伪造节点关系，并把资料不足保留为开放问题。
- 专题修订把旧脉络作为不可信的比较材料，而不是新版证据；新版所有节点仍必须引用当前 S 编号。已有脉络的专题无法通过空 map 保存请求被清除，修订预览也不能在采用前创建开放问题任务。
- 证据星图不调用模型，也不持久化隐藏关系。实线只来自已经校验的视频 URL、画面 ID、知识卡 ID、专题来源 ID 与复习来源 ID；跨来源知识点线只提示共享标签或词项，不表示因果、支持或事实一致。
- 间隔复习由本地固定规则计算：忘记后 10 分钟重现，其他评分按历史间隔与有限的难度系数排期。用户的评分只改变排期，不会被解释成能力、长期记忆或学习成果。
- 周回顾 Agent 只接收经过服务端裁剪的周度事实快照；没有真实记录时拒绝生成，不能把推测写成经历或结果。
- 迁移卷只在浏览器中生成和读取，不调用模型或上传服务端；Base URL、模型名称、API 密钥和本地音视频原文件不会进入迁移卷。SHA-256 用于发现明文内层损坏或改动，不用于证明文件来源可信。
- 加密迁移卷使用每份文件随机生成的 16 字节盐、PBKDF2-HMAC-SHA-256 600,000 次派生、AES-256-GCM、随机 12 字节 IV 和 128 位认证标签；版本、封卷时间与算法参数也作为附加认证数据。保护口令与不可导出的派生密钥只存在于当前页面内存，不写入文件或浏览器存储。
- 加密层保护离开当前设备后的迁移文件，不能保护已经被控制的浏览器、用户主动截屏或复制出的明文，也不能弥补容易猜测的口令。应用没有口令恢复渠道；遗忘口令后加密卷无法解锁。迁移卷自身不会上传；同步文件也只在用户点击生成或读取时经用户选择的路径移动。
- 普通迁移恢复是工作台与本地资料库的整体替换，不会静默合并两个状态；只有带共同父版本证据的同步分叉才会提供独立的三方合并模式。字幕和采样帧在同一个 IndexedDB 事务中替换。恢复前快照只保留在当前页面内存，刷新或关闭页面后不可撤回，因此长期退路仍应保留原迁移卷或同步包。
- 兼容检查先完成外层格式、版本和 SHA-256 校验，再用当前工作台解析器建立迁移后的候选状态。报告比较源对象与候选对象的稳定 ID、数量、引用和画面数量；旧版卷会明确显示 `源版本 → v11`，超出当前上限、格式无效、孤立来源或悬空引用会在写入前列出。兼容报告只描述当前解析结果，不会改写原文件，也不会把被忽略内容包装成成功迁移。
- 同步设备身份与工作数据分库存放。ECDH、ECDSA 私钥均为不可导出的 `CryptoKey`；成员设备收到的同步空间密钥也不可导出。只有创建设备的空间密钥保持可包装能力，用于用户明确确认后的新设备授权；所有密钥都不写入工作台状态、迁移卷、同步 JSON 明文或浏览器 `localStorage`。
- 授权请求、授权回执和同步包都使用 ECDSA P-256 / SHA-256 签名。设备指纹同时覆盖密钥协商公钥与签名公钥；请求或回执的名称、有效期、公钥、空间信息、密钥密文任一被替换都会验签失败。指纹核对仍依赖用户通过可信渠道比较完整字符串，签名不能替代首次信任判断。
- 授权回执使用 P-256 ECDH 共享秘密和 HKDF-SHA-256 派生一次性 AES-256-GCM 包装密钥；随机盐、IV、授权头与目标设备身份都会绑定进认证过程。回执只在 24 小时请求有效期内接受，且只能由请求设备的本地私钥解锁。
- 同步快照以随机 IV 的 AES-256-GCM 加密完整迁移卷，并由发送设备签名认证版本头和密文。传输位置可看到格式版本、空间 ID、父/子版本 ID、时间、发送设备 ID 与公钥指纹、算法和近似文件大小，但看不到设备名称、工作台内容、内层校验值或导出时间。
- 同步层不会自动连接网盘、对象存储、账户或网络端点。文件适配器的下载与导入、远端适配器的检查、续签与发布都需要当前用户点击；模型、行动 Agent 和源码 Agent 都不能创建空间、授权设备、生成授权回执、续签凭据、导出、导入或远端发布同步包。对象地址、Bearer 令牌、SigV4 Access Key、Secret、Session Token、到期时间和续签服务 Token 只保留在当前组件内存，切换配方或连接范围会清除已有远端版本证明；broker 签发的范围凭据还会立即清除。R2 临时凭据或 AWS STS/Cognito 等短期凭据优先；长期密钥虽可签名，但不建议交给浏览器页面。
- 条件对象适配器只接受 HTTPS（本机回环地址可用 HTTP），拒绝 URL 内嵌账号密码、混用预签名查询参数和跨站重定向；只上传通过同步包解析器的密文。首次发布使用 `If-None-Match: *`，后续发布必须先读到强 ETag 并使用 `If-Match`。远端版本与本机预期不一致、服务器返回 409/412、遗漏强 ETag 或发布后回读版本不一致时，本地版本头保持不变，不会退化为无条件覆盖。R2 与 S3 配方只生成单对象地址，不把一次一操作的预签名 URL 包装成可读写连接；CORS 配方限定当前工作台 Origin，只允许 GET/PUT 和签名所需请求头，并显式暴露 ETag。
- SigV4 凭据如果带到期时间，会在每次请求签名前重新检查；已经到期或剩余不足 30 秒时不发出网络请求。Session Token 没有到期时间时明确显示“期限未知”，不会伪装成长期有效。续签服务只收到供应商、桶、单一对象 Key、Region、GET/PUT 意图与 TTL，不会收到当前 SigV4 凭据；父级 R2/AWS 凭据必须留在可信服务端。
- 本地凭据代理是可选参考模板，不随工作台自动启动。它固定绑定 IPv4 回环地址，并同时检查远端地址、Host、Origin 与可选 Bearer；父级云凭据只从代理进程环境读取，不写入页面或响应。R2 使用精确 `actions + objectPaths` 的本地 JWT 签发；AWS 使用精确对象 ARN 的 STS 会话策略。权限票据会通过重新生成和字段闭集比较拒绝额外操作、前缀、通配符与隐藏字段，但不能替代云端父级权限、角色信任、桶策略和 SCP 的独立审计。
- 部署代理必须使用 HTTPS 且强制至少 16 字符的独立 Bearer。Cloudflare Worker 只从 required secret bindings 读取 R2 父凭据；AWS Lambda 只使用运行时注入的执行角色临时凭据，显式运行角色只允许 AssumeRole 到声明角色。GitHub Actions 到 AWS 的发布身份使用 OIDC 短期会话，信任策略绑定不可变仓库 ID 与受保护 Environment；Cloudflare Workers Builds 仍依赖 Cloudflare 保存的长期用户 Token，不应称为 OIDC。两种部署端点仍然公开可达，Origin/CORS 不是身份验证，Bearer 也不能替代云端限流、预算监控、密钥轮换与访问日志审计。普通发布封签只证明文件内部、来源声明和当前界面绑定一致；AWS 部署回执还绑定 CI Run、不可变 Lambda Version 与 CodeSha256。无 Token 的 GitHub 公共 Run API 核对只能确认声明的 Run 确实成功，不能证明导入文件由该 Run 签发；必须再通过 GitHub Attestation CLI 验证才能建立文件与工作流来源信任。
- 无秘密连接诊断限制为 64 KiB，只记录配方、凭据生命周期、脱敏错误分类、条件写入契约，以及端点、对象、Access Key ID、版本 ID 与 ETag 的 SHA-256 摘要。严格读取器拒绝未声明字段、状态矛盾和封签不匹配；摘要没有设备签名，因此只能证明文件内部完整一致，不能证明签发者身份，也不是连接授权或可重放配置。摘要不是匿名凭证：知道候选地址、Key 或 ETag 的接收方仍可计算并比对。
- 同步信任仍是由创建设备逐台授权的星形模型：创建设备认识每个成员，成员只认识创建设备和自己。只有创建设备可以发起撤销；撤销会原子保存“已停用旧空间 + 仅含创建设备的新世代”，生成新的 AES-256-GCM 空间密钥与随机空间 ID，并下载由创建设备 ECDSA 签名的轮换记录。新世代在创建设备的本地密钥库中继承撤销 ID 阻止清单，拒绝误把同一设备重新授权；界面不会把“从列表隐藏”伪装成撤销。
- 被撤销设备已经拥有的旧空间密钥和轮换前数据无法远程收回；轮换只保证它不能解锁新世代。轮换记录不含新旧空间密钥，成员导入后会核验旧空间中已经信任的创建设备指纹：被撤销设备只会看到明确撤销状态，保留设备也不会直接得到新密钥，必须重新生成授权请求。新空间 ID 不允许覆盖旧空间的远端对象，因此 HTTP 传输需要连接一个新的空对象地址。
- 离线所有者恢复材料只允许由仍在使用的创建设备为当前活跃空间生成。原创建设备用本地 ECDSA 私钥签名“旧空间世代 + 一次性恢复公钥”，再用 PBKDF2-HMAC-SHA-256 600,000 次派生的 AES-256-GCM 密钥加密恢复私钥、旧空间密钥、授权设备清单和撤销清单。文件外层会暴露旧空间 ID、名称、世代、当时版本头、创建时间、原创建设备公钥与指纹，但不会暴露空间密钥、恢复私钥或工作台内容。恢复口令不持久化，应用无法找回遗忘口令。
- 创建设备下载恢复材料后只在同步密钥库登记维护回执：材料 ID、空间世代、所有者指纹、授权/撤销清单摘要、绑定版本头、演练版本和时间，以及用户手动确认时间。回执不保存恢复文件、口令、密钥、同步包或工作台内容，也不进入迁移卷和同步包。用户可另行导出最大 128 KiB 的无内容审计摘要；v2 把原创建设备的公开身份纳入整体 SHA-256 封签，并用同一设备不可导出的 ECDSA P-256 私钥签署回执 ID 与封签摘要。读取端严格限制字段集合，分别核对回执完整性、签名以及空间 ID、世代、设备 ID、完整公钥指纹和原创所有者身份；自带公钥足以验签但不自动建立信任，本机没有对应空间、设备已撤销或世代不同都会显示为未确认。未签名 v1 仍可检查完整性。两种版本都只读计算 90/180 天维护节点，可与本机同空间回执逐字段比较，不会导入密钥库、改变维护确认或触发恢复。打开同步控制台时，授权或撤销清单、所有者、世代变化会要求立即换新材料；版本头变化只要求换入最新同步包并重新演练。
- “只做恢复演练”会在当前页面内存中解锁材料、验证原创建设备签名、导入旧空间密钥、验证同步包作者签名、解密同步密文并校验内层工作台备份；成功后立即丢弃解密结果，不创建接任身份、新空间、迁移记录或恢复预检。90 天是演练提醒，180 天是操作维护复核，不表示密码学自动失效；浏览器不能检查实际离线保管位置，“分开保存”和“旧副本已替换”必须由用户手动确认。
- 所有权恢复必须再提供同一旧空间的已签名加密同步包；错误口令、不同空间、未知作者、密文或签名修改、晚于恢复操作的包，以及早于恢复材料且不是材料所绑定版本的包都会被拒绝。解锁只形成内存候选；再次确认后才原子保存“旧空间停用 + 新所有者的新世代”，旧所有者加入新世代阻止清单。恢复出的工作台仍进入普通差异预检，不会因取得恢复权就跳过数据写入确认。
- 所有权迁移记录同时携带原创建设备签发的恢复授权和恢复私钥签发的迁移结果。旧成员必须用本地已经信任的原创建设备公钥验证授权，并要求本地版本头与迁移记录一致；验证成功后也只会停用旧空间，不能直接得到新密钥，仍需向新所有者提交新授权请求。恢复材料的离线副本无法远程撤回；文件与口令同时泄露会允许解锁旧数据并建立竞争迁移，因此应与最新同步包分开保管，并在空间轮换或授权设备清单变化后重新生成和替换保存材料。迁移后的远端传输必须使用新的空对象地址。
- 同步包先判断首次版本、顺序后继、重复版本和分叉。每个空间最近 4 份同步包以原始加密形式保存在同步密钥库，用于寻找分叉包声明的共同父版本；不会另外保存一份明文历史。浏览器配额不足、父版本过旧或版本证据缺失时，系统只提供整体迁入差异，绝不会拿两份现状猜测三方合并。
- 三方合并先以工作台稳定对象 ID、创作定位、今日焦点、字幕来源和画面来源对齐数据。与共同父版本相比，只有一侧变化时自动采用变化侧；当同一普通 JSON 对象两侧都有变化时，再递归到字段路径：不同字段自动拼合，同一字段的不同结果必须逐项明确选择。数组仍作为一个不可拆分字段处理；对象删除与另一侧修改也保持整对象选择，避免猜测顺序、成员身份或删除意图。界面不会为冲突预选本机或迁入版本，全部选择完成前拒绝写入。批量裁决必须先由分类、字段路径、状态与搜索定义可见范围，再由用户明确选择一侧；它只填未决项、不覆盖已有人工选择，并可撤回最近一次批量。最终结果再次经过完整状态迁移、引用约束和媒体来源清洗，避免选择后留下悬空任务、知识引用或孤立媒体。
- 确认三方合并后，迁入版本成为主父版本，本机原版本作为另一条待发布父线；下一次由用户生成同步包时，两条父线与合并密文一起接受加密和设备签名。双父版本使用同步包 v2，读取端仍兼容只有单父版本的 v1 包。撤回本次合并会同时恢复工作台、媒体库、原版本头与原合并父线。可下载的 v3 决策回执只记录格式版本、时间、空间与版本 ID、源卷校验值、对象 ID、字段路径、本机/迁入选择和公开设备身份，不复制对象标题、字段值或私钥；SHA-256 封签覆盖签发者与全部决策，设备签名再绑定回执 ID 和封签摘要。严格离线检查会拒绝隐藏字段、重算冲突清单与整体封签并验证 ECDSA 签名；可信成员结论还必须用空间 ID、设备 ID 和完整公钥指纹匹配本机保存的授权清单，自带公钥本身只足以验签，不等于可信。未获得本地签名上下文时仍生成明确标注的 v2 未签名回执，v1 则标为无封签。回执用于人工审计，不是同步包、明文历史或可自动重放的补丁。
- 源码 Agent 可以在白名单目录中提出源码变更；它不拥有终端、Git 或 GitHub 工具。
- 源码变更经过路径、敏感信息、危险能力、Git 基线和文件哈希检查；工作区不干净或基线变化时拒绝创建分支。
- 用户确认后，本地服务只在 Git 忽略的临时 worktree 写入提案，只运行不会导入提案模块的 ESLint 与 TypeScript 静态检查，并只暂存提案白名单文件；失败会清理临时 worktree 与新分支。完整构建和产品测试留给人工审阅后的本地流程或远端 CI，避免在采用前执行模型生成的源码。
- 自动提交关闭仓库 hooks，分支名来自提案 UUID，提交必须直接基于封存 SHA。远端推送和草稿 PR 是第二次独立确认，并会显示远端提交是否仍与验证版本一致。
- 个人工作数据只保存在当前浏览器的 localStorage 与 IndexedDB。

## 源码进化与远端审阅

进化实验室目前允许修改产品界面、组件、纯本地功能状态、样式、测试和 README。模型连接、Agent 服务、依赖、构建配置、环境变量与 Git 元数据永远不在可写范围内。

每份源码提案保存在本机忽略目录 `.evolve/` 中，包含原始文件、目标文件、Git 基线、哈希、验证结果和审计事件。确认创建分支时，应用会在 `.evolve/worktrees/` 建立短生命周期 worktree；校验通过后只保留 `evolve/proposal-*` 分支与提交，不切换或改写当前工作分支。

远端审阅需要本机已经登录 GitHub CLI（`gh auth status`）并配置 GitHub `origin`。点击“推送并开启草稿审阅”后还需再次确认；应用只推送当前提案分支，并以封存时的分支作为 PR base。

早期版本中已经直接应用到工作区的提案仍可在终端回滚：

```bash
pnpm evolve:rollback
```

也可以在命令后附加提案 ID，回滚指定的旧版已应用提案。新提案不会直接写入当前工作区，因此无需文件回滚；是否采用由远端审阅与后续合并决定。

## 下一阶段能力路线

视频字幕、关键帧、OCR、视觉问答、带可暂停哈希队列与重复内容报告的外部原文件索引、多来源学习专题、修订审阅、证据星图、口令加密、可逆本地数据迁移、版本兼容证明、设备授权与密钥轮换、带演练提醒、替换清单、设备签名与可信签发者核对的离线所有者恢复、供应商无关的加密同步包、通用 HTTP、Cloudflare R2 与 Amazon S3 条件对象传输、短期凭据到期阻断与显式续签、单对象最小权限剪票、本地/Worker/Lambda 凭据代理、带 Git 来源与运行时文件哈希的发布封签、GitHub Actions CI、AWS OIDC 无长期部署密钥发布、不可变 Lambda 云端版本回执、GitHub Artifact Attestation、Cloudflare Workers Builds 边界、无秘密连接诊断、字段级三方合并、可离线校验的无内容决策回执、显式批量冲突校样与提案分支审阅已经可用，后续继续补齐：

1. 在浏览器内验证 GitHub Attestation Bundle，并把 Cloudflare Worker Version ID 与运行时提交挑战也做成可导入证明。

联网抓取、上传文件、Git 提交和远程协作都必须保持独立授权，不能由模型自行开启。源码提案的本地提交由用户确认触发，GitHub 推送与草稿 PR 由第二次确认触发。

# `hosp.zip` 与 MVP2 平台兼容性评估

评估日期：2026-09-08
原始文件：`hosp.zip`（本地受限数据，不进入 Git）
文件大小：3,094,487,665 bytes（约 3.09 GB）
SHA-256：`1800AB8C7B6DD24FC6D59E4F70786FBCC28E66C0F0A4E78E2990DD802106271E`

## 结论

**不能直接导入当前 MVP2，也不应通过当前 DeepSeek 云端 API 处理。**

它可以经过专门 ETL 转换后成为平台的候选数据源，但需要先解决数据许可、模型部署位置、访问控制、患者时间线定义、缺失实验室数据和大文件流式处理问题。对当前“慢性病 9 次历史记录 → 生成第 10 次方案 → 医生评分”的任务，它只有部分适配性。

## 数据集识别与粒度

文件包含 20 张 `.csv.gz` 关系表，包括 `patients`、`admissions`、`diagnoses_icd`、`omr`、`pharmacy`、`emar`、`poe` 和 `transfers`。患者表 364,627 人、住院表 546,028 次住院、223,452 名住院患者，与 PhysioNet 公布的 MIMIC-IV v3.0/v3.1 规模完全一致，因此高置信度判断为 **MIMIC-IV 3.x `hosp` 模块或其不完整副本**。压缩包没有版本说明或许可证文件，因此版本和取得途径仍需数据提供者确认。

基础粒度：

| 表 | 全量行数 | 主粒度 | 主要用途 |
|---|---:|---|---|
| `patients` | 364,627 | 每位患者一行 | 性别、锚定年龄与年份、死亡日期 |
| `admissions` | 546,028 | 每次住院一行 | 住院时间、类型、出院位置 |
| `diagnoses_icd` | 6,364,488 | 每次住院的诊断编码 | 慢性病筛选与诊断历史 |
| `omr` | 7,753,027 | 患者-日期-测量项目 | 血压、体重、BMI 等门诊测量 |

## 平台适配检查

| 检查项 | 结果 | 影响 | 严重度 |
|---|---|---|---|
| 当前 ZIP 格式 | 不支持 | MVP2 要求 `manifest.csv + patients/*.json`；该包是 ZIP 内嵌 20 张 `.csv.gz` | Critical |
| 上传体积 | 不支持 | 平台请求上限 40 MB，该文件约 3.09 GB | Critical |
| 解压方式 | 不安全于当前实现 | 当前 `unzipSync` 会尝试整包进入内存，需要改为服务端流式读取 | Critical |
| 患者唯一性 | 通过 | 364,627 个 `subject_id` 无重复 | Low |
| 住院唯一性 | 通过 | 546,028 个 `hadm_id` 无重复，患者与住院外键无孤儿 | Low |
| 时间一致性 | 轻微异常 | 175 次住院的出院时间早于入院时间，占 0.0320% | Medium |
| 纵向住院覆盖 | 有限 | 仅 7,017 人有至少 10 次住院，占住院患者 3.14% | High |
| 纵向 OMR 覆盖 | 可用但不等于完整就诊 | 68,934 人有至少 10 个 OMR 日期，占 OMR 患者 35.62% | Medium |
| 慢性病候选 | 可筛选 | 130,801 人具有糖尿病、高血压、CKD 或高脂血症编码 | Low |
| 慢性病 + 10 个 OMR 日期 | 有候选规模 | 40,774 人，但每个日期不一定是完整随访 | Medium |
| 四病种 + 10 个 OMR 日期 | 有候选规模 | 5,325 人 | Medium |
| 当前四项趋势图 | 不完整 | BP 数据丰富；OMR 中未发现 HbA1c/LDL，仅 279 条 eGFR | High |
| 实验室结果 | 缺失核心事实表 | 有 `d_labitems` 字典，但没有 `labevents.csv.gz`，无法恢复 HbA1c、LDL、常规 eGFR 趋势 | Critical |
| 模型输入合规 | 当前不满足 | 受限数据不可默认发送到第三方 LLM API | Critical |

## 主要数据质量证据

- 诊断外键完整：6,364,488 条诊断均能匹配患者和住院。
- 目标慢性病患者数：高血压 111,008；高脂血症 80,609；糖尿病 46,312；CKD 29,257。
- OMR 无空结果值，且 2,827,801 条标准血压记录格式均包含 `/`。
- OMR 主要覆盖血压、体重、BMI 和身高；不能替代实验室结果表。
- 日期范围 2105–2214 是去标识化时间平移，平台必须显示为去标识化研究日期，不能解释为真实日历年份。
- 89.50% 患者没有 `dod`。这通常代表没有可用死亡日期，并不等于患者存活。

## 为什么不适合“直接转换成现有 10 次随访”

1. `admissions` 是住院事件，往往是急性医疗，不等同于慢性病门诊随访。
2. `omr.chartdate` 能提供多个时间点，但一个日期可能只有血压或体重，并非一次包含诊断、药物和实验室结果的完整就诊。
3. 若简单选择最后 10 个 OMR 日期，会制造“每次都有完整病例”的错误印象。
4. 当前压缩包缺少 `labevents`，无法支撑现有界面的 HbA1c、LDL、eGFR 四项趋势和完整治疗方案审查。
5. 第 10 次记录作为参考答案需要预先定义事件边界和预测任务，否则会发生未来信息泄漏。

## 推荐适配路径

### P0：数据治理和安全

1. 向提供者确认这是哪个 MIMIC-IV 版本、下载账户、研究审批、CITI 培训和 DUA 覆盖范围。
2. 不把 `hosp.zip`、转换后的患者记录或模型提示上传到公开 GitHub。
3. 在完成 DUA 与模型服务合规核验前，禁用该数据集到 DeepSeek 云端 API 的调用。
4. 推荐改用本地部署模型；若考虑云端服务，必须书面确认零数据保留、不训练、不进行人工审阅，并由研究负责人批准。

### P1：补齐数据

1. 从已获授权的同一 MIMIC-IV 版本补充 `labevents.csv.gz`；如需要处方计划，补充 `prescriptions.csv.gz`。
2. 保留 `d_labitems`、`d_icd_diagnoses` 等字典表并进行版本一致性检查。
3. 明确项目是否继续做“慢性病长期管理”；如果目标不变，需评估 MIMIC 是否过度偏向住院场景。

### P2：新增专用 ETL 适配器

1. 在本地后端流式读取 ZIP → GZIP → CSV，禁止浏览器整体上传和内存整包解压。
2. 按 `subject_id` 建立患者主索引，按 `hadm_id` 连接住院、诊断、药物和事件。
3. 将 ICD-9/10 映射为平台标准病种；按锚定年龄和年份计算年龄。
4. 定义可审计的 `visit`：建议以住院 episode 为主，OMR 作为 episode 前后窗口内的补充测量，而不是把每条 OMR 当作一次就诊。
5. 只选择满足 10 个合格 episode 且核心字段齐全的患者；前 9 个 episode 输入模型，第 10 个只作为锁定参考。
6. 为转换结果添加字段级来源：`source_table`、`source_row/key`、`subject_id`、`hadm_id`、`charttime` 和转换规则版本。
7. 先生成 50–100 例受控试验队列，再评估是否扩大；不建议首次就导入全部 36 万名患者。

## 最小验收标准

- 每个病例恰好有 10 个按时间排序且定义一致的 episode。
- 前 9 次模型输入不包含第 10 次及其后的事实。
- 所有展示数值可追溯到原表、主键和时间戳。
- HbA1c、LDL、eGFR、BP 的单位和缺失状态明确，不允许凭空填补。
- 患者标识仅使用去标识化 ID；Doctor 端明确标注 `De-identified real-world data`，不能继续标注 `Synthetic`。
- 数据不离开批准的研究环境，且不进入公开仓库。

## 可复核材料

- 全量机器可读画像：`output/hosp-profile-2026-09-08.json`
- 画像脚本：`scripts/profile-hosp-dataset.py`
- 官方规模与访问要求：[MIMIC-IV v3.1](https://physionet.org/content/mimiciv/3.1/)
- 官方受限数据许可证：[PhysioNet Credentialed Health Data License](https://physionet.org/content/mimiciv/view-license/3.1/)
- 官方 LLM 使用说明：[Use of MIMIC Data with Large Language Models and Online Services](https://physionet.org/news/post/llm-responsible-use/)
- 官方实验室表说明：[MIMIC-IV labevents](https://mimic.mit.edu/docs/iv/modules/hosp/labevents.html)

final result: requires ETL and governance approval; not directly compatible

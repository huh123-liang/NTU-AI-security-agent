# MIMIC HOSP → MVP2 平台兼容性验证

验证日期：2026-09-15
验证范围：本地只读源数据检查、25人代表性子集、Schema Discovery、Admin Mapping、预处理、隔离 SQLite 入库、模型输入构建。未调用外部大模型，未写入正式平台数据库，未上传 GitHub。

## 结论

**有条件跑通。** 经过 Admin 人工修正字段映射后，25人试验集能够完成预处理并写入与平台一致的 SQLite 数据结构：25/25病例有效，0例因格式失败被隔离，产生197条结构化来源追踪记录。

但原始的5.868 GiB目录目前不能直接、安全地“一键全量导入”。默认自动映射存在严重误判，实验室字典关联、模型上下文压缩和本机磁盘空间也尚未达到全量运行条件。因此当前结果是“技术链路验证通过”，不是“全量临床字段适配完成”。

## 数据集与粒度

- 源目录包含22个 `.csv.gz` 文件，总计6,300,755,975 bytes（5.868 GiB）。
- `patients` 是患者粒度；`admissions` 是住院事件粒度；`diagnoses_icd`、`labevents`、`prescriptions` 等是患者/住院/事件混合粒度。
- 所有22个文件均成功读取Header和首条记录；本轮没有对所有压缩流执行全量解压完整性校验。
- 核心表齐全，包括 `patients`、`admissions`、`diagnoses_icd`、`omr`、`labevents` 与 `prescriptions`。

## 试验方法

从源表按 `subject_id` 一致性提取25名患者，保留原字段和原值，形成1.69 MB的本地试验ZIP。选择10张与平台病例评估直接相关的表，分别执行：

1. 平台Schema Discovery；
2. 默认自动映射试跑；
3. Admin修正映射试跑；
4. 生成平台标准病例JSON和质量报告；
5. 导入隔离SQLite并核对病例、版本、Lineage与Task Type；
6. 构建模型输入Prompt，但不发送给外部API。

## 通过项

| 检查 | 结果 |
|---|---:|
| 试验患者 | 25 |
| 预处理后Eligible Cases | 25 |
| 隔离SQLite成功入库 | 25 |
| 格式失败隔离 | 0 |
| Record Lineage | 197 |
| `single_visit` | 4 |
| `short_longitudinal` | 11 |
| `standard_longitudinal` | 10 |
| 预处理识别的有效测量（Visit截断前） | 723 |
| 被范围规则拒绝的测量 | 41 |
| 明确标记的有限LOCF展示字段 | 66 |

这证明平台已经可以处理“不足10次就诊”的病例，并按当前规则自动分流为单次、短纵向和标准纵向任务。

## 主要问题

### Critical — 默认字段映射不安全

通用启发式把6个非患者标识字段误识别成 `patient_id`，包括 `admit_provider_id`、`labevent_id`、`itemid`、`pharmacy_id` 和 `poe_id` 等。直接接受默认建议后，25人试验集错误膨胀为2,792个“患者”。

影响：患者关联错误会污染病例、评分和后续Ground Truth，必须在发布前阻断。
建议：为MIMIC HOSP增加受版本控制的Mapping Profile；ID字段不再仅凭“唯一性高/以id结尾”自动判断；要求Patient ID只能由Admin显式确认。

### High — 实验室字典尚未关联

`labevents.itemid`需要与 `d_labitems.itemid`连接，才能得到HbA1c、LDL等人类可读的检验名称。当前Canonical Schema没有 `observation_code`/Lab Dictionary Join，因此22/25试验病例虽然保留了实验室数值，却以数字Item ID显示，无法可靠生成HbA1c、eGFR、LDL趋势。

建议：加入 `observation_code`，建立Observation Dictionary角色，并在预处理时执行 `itemid → label` Join；同时记录原Item ID和字典版本。

### High — 模型输入过大

代表性Prompt长度：单次病例3,389字符、短纵向病例82,407字符、标准纵向病例119,104字符。后两类会显著增加超出Context Window、延迟、费用和模型忽略关键信息的风险。

建议：加入按任务选择的Observation白名单、同日去重、最新/异常/趋势摘要、Medication去重和明确的Token Budget；完整原始数据继续保留供Doctor追溯，不全部塞入模型Prompt。

### High — 当前磁盘空间不足以全量上传

平台在建立任务时要求至少保留ZIP大小的2.2倍空间。全目录5.868 GiB，对应最低12.91 GiB；验证时C盘只剩9.90 GiB。即便只打包10张相关表，压缩数据也约3.082 GiB，后续Staging SQLite仍可能超过现有余量。

建议：不要在当前C盘全量复制；优先支持Admin选择本地受控目录或把Ingestion Workspace迁移到空间更充足的磁盘，并增加预估Staging大小与运行中磁盘保护。

### Medium — 输入形态不一致

当前Admin Intake接受“包含CSV/CSV.GZ的ZIP”，而本次数据是文件夹。试验ZIP可用，但全量再次封装会产生大体积副本。

建议：增加受控的“Local directory import”模式，只在本机Admin环境读取目录，并继续生成不可变的Hash、Mapping、Quality Report与Approved Version。

## 是否可以开始在平台里测试？

可以使用本次25人Pilot进行界面、病例选择、Doctor评分与Admin汇总测试。它保存在Git忽略的 `.data/validation/`，尚未导入正式平台数据库。正式使用前至少应先修复ID自动映射和Lab Dictionary Join；外部模型生成前还应实施Prompt压缩并由Admin确认数据出境边界。

## 可复现证据

- 机器可读结果：`output/mimic-hosp-platform-validation-2026-09-15.json`
- Pilot构建器：`scripts/build-mimic-hosp-pilot.py`
- 隔离SQLite导入验证器：`scripts/verify-processed-import.mjs`
- Pilot、Mapping、Processed Output及测试数据库：`.data/validation/`（Git忽略，仅本机）

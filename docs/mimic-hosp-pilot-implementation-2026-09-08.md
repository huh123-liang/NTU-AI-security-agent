# MIMIC-IV HOSP 本地试验数据集实施记录

日期：2026-09-08
用途：MVP2 本地功能测试（未上传 GitHub）

## 实施结果

- 原始归档：`hosp.zip`，SHA-256 `1800ab8c7b6dd24fc6d59e4f70786fbcc28e66c0f0a4e78e2990dd802106271e`
- 合格候选：29,618 名患者
- 固定规则抽样：100 名患者
- 导出与导入：100 例有效，0 例隔离
- 每例：10 个按时间排序的标准 Blood Pressure 实测日期
- 总计：1,000 次纵向记录、2,000 个实测血压值
- 血压范围：收缩压 78–192 mmHg；舒张压 33–116 mmHg
- 其他实测字段：1,326 个；有限 LOCF 字段：1,185 个
- 显示 ID 已伪名化；受限 ID 映射仅保存在 `.data/derived/`，不进入导入包
- 原始年龄顶码的患者在界面显示为 `Age 91+`，不制造虚假的精确高龄

## 缺失数据规则

1. 血压必须为实际 OMR 记录，格式和值域不合格的记录被删除；共排除 1,501 条不合理候选行。
2. BMI、体重仅允许 365 天内的末次观测前向填充，身高允许 1,825 天；每个填充值均标记 `imputed=true`、来源日期和方法。
3. HbA1c、LDL 不存在于所给 HOSP 归档，保持不可用，不插补。
4. eGFR 仅在 OMR 同日有实测值时使用，不插补。
5. 归档中没有 `prescriptions`，因此不构造药物信息。
6. 缺失的过敏史、吸烟史、症状、虚弱状态不能解释为“无”，统一显示为不可用。

## 使用边界

这是一个 BP 为中心的纵向平台测试集。第 10 次记录是被隐藏的未来测量，用于验证时间切分；它不是完整的临床治疗方案 Ground Truth。模型提示只接收前 9 次记录，并被要求不得将缺失字段解释为正常或虚构临床事实。

## 本地文件

- 转换包：`.data/derived/mimic-hosp-bp-pilot-100.zip`
- 机器可读报告：`.data/derived/mimic-hosp-bp-pilot-100-report.json`
- 受限 ID 映射：`.data/derived/mimic-hosp-bp-pilot-100-restricted-id-map.csv`
- SQLite 数据库：`.data/platform.db`

这些路径均受 `.gitignore` 中的 `.data/` 规则保护。

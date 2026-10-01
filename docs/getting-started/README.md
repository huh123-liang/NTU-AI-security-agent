# Install and launch / 安装与启动

[Project home](../../README.md) · [Documentation](../README.md)

## 1. Prepare your computer

Use Windows for the provided double-click launchers. Install **Node.js 24 LTS**, npm and **Python 3.10+**; ensure Node and Python are available on PATH. The backend imports the built-in `node:sqlite` module: Node.js 20 does **not** support that backend, despite the older wizard's coarse version check. Python preprocessing uses the standard library.

Initial dependency installation requires internet access. Model generation also requires connectivity to your chosen provider and your own API credentials. GitHub is not an online deployment of this application.

## 2. Download and set up

1. On GitHub, choose **Code → Download ZIP**, then extract the archive. Alternatively, clone the repository.
2. Open the extracted repository root; it contains `package.json` and the launchers. There is no extra `MVP2/` level to enter in a fresh clone.
3. Double-click [First-Time-Setup.cmd](../../First-Time-Setup.cmd) or [首次安装向导.cmd](../../首次安装向导.cmd).
4. Follow the checks and hidden API-key prompt. You can skip model configuration to inspect the interface.

The wizard installs dependencies, builds, runs tests and starts the local platform. It does not upload your local database or credentials to GitHub.

## 3. Return next time

Double-click [Start-Platform.cmd](../../Start-Platform.cmd) or [一键启动-AI医疗评估平台.cmd](../../一键启动-AI医疗评估平台.cmd). Use [Stop-Platform.cmd](../../Stop-Platform.cmd) to stop the verified local instance.

The launcher verifies the project/service identity, uses 4190 by default and tries 4191–4199 when needed, then opens the selected address. A shortcut copied from somebody else's computer may point to their directory: use the launchers inside your own extracted folder.

## 4. Try the workflow

- Admin demo login: `admin@ntu-demo.local`, password `123` — local demonstrations only.
- Doctors can self-register on the Doctor tab of the unified login screen.
- If a bundled synthetic cohort is present in `data-source/`, the local API can import it on first initialization. If it is absent, ask Admin to import an appropriate synthetic dataset; the app itself still starts.
- Admin configures **Model registry** and generates an **Official Run**. Doctors evaluate that fixed answer independently.
- A fresh clone does not include another person's scores, patient database, model settings or generated answers.

## Developer verification

Run from the repository root:

```powershell
npm install
npm run build
```

Then run `npm test` and start with `npm start -- 4190`. The Windows launcher is the normal end-user entry point. `npm run dev` is available but production build + local server is the preferred Windows path.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `node:sqlite` unavailable | Install Node.js 24 LTS, reopen the terminal and rerun setup |
| Page does not open | Run the launcher in this repository, not an old copied shortcut; inspect `.runtime/` locally |
| No patients on a new computer | The live `.data/` database is intentionally not distributed; check the bundled sample/import workflow |
| AI answer cannot be generated | Check the selected registry configuration, credentials, provider network access and the run's error |
| Output budget exhausted | Create/select an updated model configuration with sufficient tokens; truncated output is not accepted |
| Different port than expected | Let the launcher open its verified address; an occupied port is not reused blindly |

See [detailed generation troubleshooting](../reference/engineering-details.md). Do not share logs containing private clinical text. Never resolve setup issues by publishing `.env.local`, `.data/` or API keys.

# Frontend / 前端界面

[Project home](../README.md) · [Architecture](../docs/architecture/README.md)

| File | Responsibility |
| --- | --- |
| [main.jsx](main.jsx) | React application entry |
| [App.jsx](App.jsx) | Session restoration, role navigation, language, logout and notifications |
| [AuthPage.jsx](AuthPage.jsx) | Unified login and Doctor registration |
| [DoctorPortal.jsx](DoctorPortal.jsx) | Dataset/case selection, clinical chart review, evidence and scoring |
| [AdminPortal.jsx](AdminPortal.jsx) | Account governance, intake, model registry, official responses, comparisons and aggregation |
| [AdminDatasetUploadModal.jsx](AdminDatasetUploadModal.jsx) | Admin dataset upload interface |
| [api.js](api.js) | Browser API client and local session handling |
| [components.jsx](components.jsx) | Shared shell, modals, cards, charts and notification components |
| [constants.js](constants.js), [styles.css](styles.css) | Shared UI constants and styling |

This directory renders the interface; it does not own SQL storage or provider credentials. All protected actions go through `/api/v1`. Never add API keys, private datasets or clinical exports to frontend source.

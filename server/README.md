# Backend (deferred)

Per spec §7.2 the MVP has **no backend**: inference and rendering run entirely in the browser and the app is served as static files.

Add a FastAPI + PostgreSQL service here only when there is a defined need (accounts, saved sessions, central asset management, research data collection). The endpoint contract is in spec §8.2. Never accept continuous video frames, and define consent, retention, encryption and deletion before storing any capture.

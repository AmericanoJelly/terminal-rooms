# Deploy Guide

## Render
1. Create a new GitHub repo and upload this project.
2. In Render, create a new Web Service from the repo.
3. Render will detect `render.yaml` automatically.
4. After deploy, open the provided URL.

## Notes
- Current storage is in-memory. If the service restarts, rooms and messages are lost.
- This is fine for demos, not for durable production use.
- To make it production-ready, add PostgreSQL and persist rooms/messages/participants.

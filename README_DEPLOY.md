# Deploy to Render + Neon (Free)

## 1) Create a free Postgres on Neon
- Go to https://neon.tech → Create project (Free tier).
- Copy the **connection string**; append `?sslmode=require` if not present.

## 2) Set up environment variables
On Render (or locally for testing), set:

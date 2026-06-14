# Minecraft-Themed 3D WebGL Portfolio

A highly interactive, cinematic, and premium Minecraft-themed 3D portfolio featuring breakable block skills, smooth camera transitions, scrolling snap-stack project cards, and a RAG-powered Minecraft-GUI chatbot widget.

---

## 🛠️ Security & Architecture

This project is built with production-grade security and is optimized to run serverless on **Vercel** or clustered under **PM2**.

* **Content Security Policy (CSP)**: Powered by `helmet` to strictly whitelist source CDNs (Three.js, GSAP, Lenis, EmailJS) and prevent cross-site scripting (XSS) or data injection attacks.
* **CORS Policy**: Configured to restrict access only to allowed client origins (configurable dynamically via environment variables).
* **Payload Protection**: Express middleware strictly limits body payload sizes to `20kb` to prevent Denial of Service (DoS) entity-too-large attacks.
* **Failover LLM Chain**: If the primary Gemini API keys fail or hit rate limits, the chatbot seamlessly falls back to alternate Gemini keys, OpenAI, or Groq APIs.
* **Graceful DB Fallbacks**: BullMQ and Redis operations degrade gracefully without crashing the server if the Redis cache is offline.

---

## 💻 Local Setup & Development

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Configure Environment**:
   Create a `.env` file in the root directory (based on `.env.example` or your custom keys):
   ```env
   PORT=8080
   GEMINI_API_KEYS=your_primary_key,your_backup_key
   ADMIN_SECRET_KEY=your_cache_flush_secret
   # Optional Fallbacks
   OPENAI_API_KEY=your_openai_key
   GROQ_API_KEY=your_groq_key
   # Optional Databases
   REDIS_HOST=127.0.0.1
   REDIS_PORT=6379
   QDRANT_URL=http://localhost:6333
   ```

3. **Run Dev Server**:
   ```bash
   node server.js
   ```
   Open `http://localhost:8080` in your browser.

---

## 🚀 Step 1: Pushing to GitHub (Securely)

The project includes a pre-configured `.gitignore` file that automatically excludes your `.env` file, logs, and `node_modules` folders to prevent any credential leaks.

1. **Initialize Git Repository** (if not already initialized):
   ```bash
   git init
   ```

2. **Stage and Commit Files**:
   ```bash
   git add .
   git commit -m "feat: optimize transitions and prepare for Vercel deployment"
   ```

3. **Add GitHub Remote & Push**:
   Create a new, empty repository on GitHub, then run:
   ```bash
   git branch -M main
   git remote add origin https://github.com/your-username/your-repo-name.git
   git push -u origin main
   ```

---

## 🌐 Step 2: Deploying to Vercel

The project is pre-configured with `vercel.json` to leverage **Vercel's Serverless Functions** for backend routing (`/api/...`) while serving all static assets (HTML, CSS, JS, textures, images) natively through **Vercel's Edge CDN** for maximum loading performance.

1. **Go to Vercel**:
   Log in to the [Vercel Dashboard](https://vercel.com).

2. **Import Repository**:
   * Click **Add New** ➜ **Project**.
   * Link your GitHub account and select your portfolio repository.

3. **Configure Settings**:
   * **Framework Preset**: Select **Other**.
   * **Root Directory**: `./` (or select the project directory if nested).
   * **Build & Development Settings**: Leave as default (Vercel automatically understands the static assets and builds the serverless API).

4. **Add Environment Variables**:
   In the **Environment Variables** section, add your production keys:
   * `GEMINI_API_KEYS` = `your_gemini_api_key_here` (and backups, comma-separated)
   * `ADMIN_SECRET_KEY` = `your_cache_administration_secret_here`
   * `ALLOWED_ORIGINS` = `https://your-portfolio-domain.com,https://your-project.vercel.app` (restricts API access only to your custom domain and Vercel preview URLs)
   * `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` (if using an Upstash Redis or cloud Redis database)
   * `QDRANT_URL` / `QDRANT_API_KEY` (if using an online Qdrant vector database)

5. **Deploy**:
   Click **Deploy**. Vercel will build the frontend assets, set up the `/api/chat` serverless function, and give you a live URL!

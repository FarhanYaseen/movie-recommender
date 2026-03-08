# 🎬 AI Movie Recommender

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16+-blue.svg)](https://postgresql.org/)
[![pgvector](https://img.shields.io/badge/pgvector-0.5+-purple.svg)](https://github.com/pgvector/pgvector)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> **Semantic movie recommendation engine** powered by AI embeddings and vector similarity search. Find movies based on natural language descriptions, not just keywords.

![Demo](docs/assets/demo.gif)

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🧠 **Semantic Search** | Understands meaning, not just keywords. "films about dreams" finds Inception |
| ⚡ **Fast Vector Search** | HNSW indexing for millisecond queries on millions of records |
| 🔌 **REST API** | Clean, versioned API with Swagger documentation |
| 🐳 **Docker Ready** | One-command deployment with Docker Compose |
| 📊 **Production Grade** | Health checks, graceful shutdown, structured logging |
| 📚 **Well Documented** | OpenAPI spec, Postman collection, inline comments |

---

## 🎯 Use Cases

- **Streaming Platforms** — "Show me something like Black Mirror but funnier"
- **Movie Discovery Apps** — Natural language movie search
- **Content Recommendation** — Find similar content based on descriptions
- **E-commerce** — Adapt for product recommendations
- **Knowledge Bases** — Semantic document search

---

## 🛠️ Tech Stack

```
┌─────────────────────────────────────────────────────────────┐
│                      Architecture                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Client Request                                            │
│        │                                                    │
│        ▼                                                    │
│   ┌─────────┐    ┌──────────┐    ┌─────────────────────┐   │
│   │ Express │───▶│ Voyage   │───▶│ PostgreSQL          │   │
│   │ API     │    │ AI API   │    │ + pgvector          │   │
│   └─────────┘    └──────────┘    └─────────────────────┘   │
│        │              │                    │                │
│        │         Embeddings          Vector Search          │
│        │         (1024-dim)          (Cosine Distance)      │
│        ▼                                   │                │
│   JSON Response ◀──────────────────────────┘                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

| Technology | Purpose |
|------------|---------|
| **Node.js + Express** | REST API server |
| **PostgreSQL + pgvector** | Vector database for similarity search |
| **Voyage AI** | State-of-the-art text embeddings |
| **Docker** | Containerized deployment |
| **Swagger UI** | Interactive API documentation |

---

## 🚀 Quick Start

### Option 1: Docker (Recommended)

```bash
# Clone the repository
git clone https://github.com/yourusername/movie-recommender.git
cd movie-recommender

# Set your API key
echo "VOYAGE_API_KEY=your_key_here" > .env

# Start everything
docker compose up -d

# Seed the database (wait ~5 min for rate limits)
docker compose exec app node src/scripts/seed.js

# Try it out
curl "http://localhost:3000/api/v1/movies/recommend?q=mind+bending+sci-fi"
```

### Option 2: Local Development

```bash
# Prerequisites: Node.js 18+, PostgreSQL 16+ with pgvector

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Start the server
npm run dev

# Seed movies (in another terminal)
npm run seed
```

---

## 📡 API Endpoints

### Get Recommendations

```bash
GET /api/v1/movies/recommend?q=<query>&limit=<n>
```

**Example:**
```bash
curl "http://localhost:3000/api/v1/movies/recommend?q=emotional%20story%20about%20time&limit=3"
```

**Response:**
```json
{
  "query": "emotional story about time",
  "count": 3,
  "data": [
    {
      "id": 3,
      "title": "Interstellar",
      "genre": "Sci-Fi / Drama",
      "year": 2014,
      "director": "Christopher Nolan",
      "description": "A team of astronauts travels through a wormhole...",
      "similarity": "0.8234"
    }
  ]
}
```

### All Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/movies/recommend?q=...` | Semantic movie search |
| `GET` | `/api/v1/movies` | List all movies |
| `GET` | `/api/v1/movies/:id` | Get movie by ID |
| `GET` | `/api/v1/health` | Health check |
| `GET` | `/api/v1/docs` | Swagger UI |

---

## 🔍 How It Works

### 1. Text → Embedding
```
"mind-bending sci-fi" → [0.12, -0.87, 0.34, ...] (1024 floats)
```

### 2. Store in pgvector
```sql
INSERT INTO movies (title, description, embedding)
VALUES ('Inception', '...', '[0.12, -0.87, ...]');
```

### 3. Similarity Search
```sql
SELECT title, 1 - (embedding <=> query_vector) AS similarity
FROM movies
ORDER BY embedding <=> query_vector
LIMIT 5;
```

### 4. Return Results
Movies ranked by semantic similarity (0-1 score).

---

## 📁 Project Structure

```
movie-recommender/
├── src/
│   ├── config/
│   │   ├── index.js          # Environment configuration
│   │   └── database.js       # PostgreSQL + pgvector setup
│   ├── middleware/
│   │   ├── errorHandler.js   # Global error handling
│   │   └── requestLogger.js  # HTTP request logging
│   ├── routes/
│   │   ├── index.js          # Route aggregator
│   │   ├── health.js         # Health check endpoints
│   │   ├── movies.js         # Movie CRUD + recommendations
│   │   └── docs.js           # Swagger UI
│   ├── services/
│   │   ├── embedding.js      # Voyage AI integration
│   │   └── movies.js         # Business logic
│   ├── scripts/
│   │   └── seed.js           # Database seeding
│   ├── app.js                # Express app factory
│   └── index.js              # Entry point
├── docs/
│   ├── openapi.yaml          # OpenAPI 3.0 specification
│   └── postman_collection.json
├── Dockerfile
├── docker-compose.yml
└── package.json
```

---

## ⚙️ Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment | `development` |
| `VOYAGE_API_KEY` | Voyage AI API key | Required |
| `DB_HOST` | PostgreSQL host | `localhost` |
| `DB_PORT` | PostgreSQL port | `5432` |
| `DB_NAME` | Database name | `movie_recommender` |
| `DB_USER` | Database user | `postgres` |
| `DB_PASSWORD` | Database password | Required |

---

## 🧪 Testing the API

### Using cURL

```bash
# Health check
curl http://localhost:3000/api/v1/health

# Get recommendations
curl "http://localhost:3000/api/v1/movies/recommend?q=scary+horror+movie"

# List all movies
curl http://localhost:3000/api/v1/movies
```

### Using Postman

1. Import `docs/postman_collection.json`
2. Set `baseUrl` variable to `http://localhost:3000`
3. Run requests from the collection

### Using Swagger UI

Open http://localhost:3000/api/v1/docs in your browser.

---

## 🚢 Deployment

### Docker Production

```bash
# Build and run
docker compose -f docker-compose.yml up -d --build

# View logs
docker compose logs -f app
```

### Environment Variables for Production

```bash
NODE_ENV=production
PORT=3000
VOYAGE_API_KEY=your_production_key
DB_HOST=your_db_host
DB_PASSWORD=strong_password_here
```

---

## 📈 Performance

| Metric | Value |
|--------|-------|
| Query latency | ~200ms (with embedding) |
| Vector search | <10ms (HNSW index) |
| Concurrent users | 100+ (connection pooling) |
| Embedding dimensions | 1024 |

---

## 🔮 Roadmap

- [ ] Add user ratings and collaborative filtering
- [ ] Implement caching for embeddings
- [ ] Add batch embedding for faster seeding
- [ ] Create React/Vue frontend
- [ ] Add authentication (JWT)
- [ ] Deploy to AWS/GCP/Azure

---

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 👨‍💻 Author

**Your Name**
- Portfolio: [yourportfolio.com](https://yourportfolio.com)
- LinkedIn: [linkedin.com/in/yourprofile](https://linkedin.com/in/yourprofile)
- Email: your.email@example.com

---

## 💼 Hire Me

Looking for a developer to build:
- **Recommendation Systems** — Products, content, music, articles
- **Semantic Search** — Natural language search for your data
- **AI-Powered APIs** — Integrate LLMs and embeddings into your product
- **Vector Databases** — pgvector, Pinecone, Weaviate, Qdrant

📧 **Contact:** your.email@example.com

---

<p align="center">
  <b>⭐ Star this repo if you found it useful!</b>
</p>

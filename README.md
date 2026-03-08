# Movie Recommender API

A semantic search engine for movies using vector embeddings. Instead of matching keywords, it understands what you're looking for — search for "films about dreams and reality" and it finds Inception, even though those words aren't in its description.

Built with Node.js, PostgreSQL, pgvector, and Voyage AI.

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16+-blue.svg)](https://postgresql.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## What it does

- **Semantic search** — Understands meaning, not just keywords
- **Vector similarity** — Uses cosine distance for accurate matching
- **Fast queries** — HNSW indexing keeps searches under 10ms
- **Production ready** — Health checks, graceful shutdown, structured logging
- **Well documented** — OpenAPI spec, Postman collection, interactive docs

---

## Tech stack

| Component | Technology |
|-----------|------------|
| API Server | Node.js, Express |
| Database | PostgreSQL with pgvector |
| Embeddings | Voyage AI (voyage-3 model) |
| Documentation | Swagger UI, OpenAPI 3.0 |
| Deployment | Docker, Docker Compose |

---

## Quick start

### Using Docker

```bash
git clone https://github.com/yourusername/movie-recommender.git
cd movie-recommender

# Add your API key
echo "VOYAGE_API_KEY=your_key" > .env

# Start the stack
docker compose up -d

# Seed the database
docker compose exec app node src/scripts/seed.js

# Test it
curl "http://localhost:3000/api/v1/movies/recommend?q=psychological+thriller"
```

### Local development

```bash
npm install
cp .env.example .env
# Edit .env with your credentials

npm run dev

# In another terminal
npm run seed
```

---

## API

### Get recommendations

```
GET /api/v1/movies/recommend?q=<query>&limit=<n>
```

Example:
```bash
curl "http://localhost:3000/api/v1/movies/recommend?q=emotional+story+about+time"
```

Response:
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
      "similarity": "0.8234"
    }
  ]
}
```

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/movies/recommend` | Semantic search |
| GET | `/api/v1/movies` | List all movies |
| GET | `/api/v1/movies/:id` | Get single movie |
| GET | `/api/v1/health` | Health check |
| GET | `/api/v1/docs` | Swagger UI |

---

## How it works

The system converts text into 1024-dimensional vectors using Voyage AI's embedding model. Similar concepts end up close together in this vector space.

```
"mind-bending sci-fi" → [0.12, -0.87, 0.34, ...]
```

When you search, your query gets converted to a vector too. PostgreSQL with pgvector then finds the movies with the smallest cosine distance to your query — that's your recommendation list.

```sql
SELECT title, 1 - (embedding <=> query_vector) AS similarity
FROM movies
ORDER BY embedding <=> query_vector
LIMIT 5;
```

The `<=>` operator calculates cosine distance. Lower distance means higher similarity.

---

## Project structure

```
src/
├── config/           # Environment and database setup
├── middleware/       # Error handling, request logging
├── routes/           # API endpoints
├── services/         # Business logic, embedding calls
└── scripts/          # Database seeding

docs/
├── openapi.yaml      # API specification
└── postman_collection.json

public/
└── index.html        # Demo frontend
```

---

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| PORT | Server port | 3000 |
| NODE_ENV | Environment | development |
| VOYAGE_API_KEY | Voyage AI key | required |
| DB_HOST | PostgreSQL host | localhost |
| DB_PORT | PostgreSQL port | 5432 |
| DB_NAME | Database name | movie_recommender |
| DB_USER | Database user | postgres |
| DB_PASSWORD | Database password | required |

---

## Deployment

```bash
docker compose up -d --build
docker compose logs -f app
```

For production, set `NODE_ENV=production` and use strong passwords.

---

## Performance

| Metric | Value |
|--------|-------|
| Query latency | ~200ms (includes embedding API call) |
| Vector search | <10ms |
| Embedding dimensions | 1024 |

---

## License

MIT — see [LICENSE](LICENSE)

---

## Author

**Farhan Yaseen**
[Portfolio](https://farhanyaseen.netlify.app/) · [LinkedIn](https://linkedin.com/in/Farhanyaseen) · farhan.yaseen.se@gmail.com

---

## Looking for similar work?

I build recommendation systems, semantic search, and AI-powered APIs. If you need help with vector databases (pgvector, Pinecone, Weaviate) or embedding integrations, get in touch.

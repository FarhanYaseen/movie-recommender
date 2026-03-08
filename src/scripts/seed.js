// src/scripts/seed.js
// Database seeding script
// Run with: npm run seed

const { config, validateConfig } = require("../config");
const { pool, setupDatabase, shutdown } = require("../config/database");
const { embedDocument } = require("../services/embedding");

const MOVIES = [
  {
    title: "Inception",
    genre: "Sci-Fi / Thriller",
    year: 2010,
    director: "Christopher Nolan",
    description:
      "A thief who steals corporate secrets through dream-sharing technology is given the task of planting an idea into the mind of a CEO. A mind-bending heist through layered dreamscapes with stunning visuals and a complex non-linear narrative.",
  },
  {
    title: "The Matrix",
    genre: "Sci-Fi / Action",
    year: 1999,
    director: "The Wachowskis",
    description:
      "A computer programmer discovers reality is a simulation and joins a rebellion against the machines controlling humanity. Features iconic slow-motion action sequences and explores themes of free will, reality, and identity.",
  },
  {
    title: "Interstellar",
    genre: "Sci-Fi / Drama",
    year: 2014,
    director: "Christopher Nolan",
    description:
      "A team of astronauts travels through a wormhole near Saturn to find a new habitable planet for humanity as Earth dies. Blends hard science fiction with an emotional story about love transcending time and space.",
  },
  {
    title: "The Shawshank Redemption",
    genre: "Drama",
    year: 1994,
    director: "Frank Darabont",
    description:
      "A banker wrongly convicted of murder befriends a fellow prisoner and finds hope and humanity in the harsh reality of prison life. A deeply moving story of friendship, perseverance, and the enduring human spirit.",
  },
  {
    title: "Parasite",
    genre: "Thriller / Drama",
    year: 2019,
    director: "Bong Joon-ho",
    description:
      "A poor Korean family schemes their way into the household of a wealthy family, but their plan takes a dark and unexpected turn. A darkly comedic class satire with shocking twists and masterful tension.",
  },
  {
    title: "The Dark Knight",
    genre: "Action / Thriller",
    year: 2008,
    director: "Christopher Nolan",
    description:
      "Batman faces his greatest challenge when a nihilistic criminal known as the Joker plunges Gotham into anarchy. A gritty crime epic that explores chaos, morality, and the cost of heroism.",
  },
  {
    title: "Spirited Away",
    genre: "Animation / Fantasy",
    year: 2001,
    director: "Hayao Miyazaki",
    description:
      "A young girl becomes trapped in a mysterious spirit world and must work in a magical bathhouse to free herself and her parents. A breathtaking animated fantasy rich in Japanese folklore, wonder, and coming-of-age themes.",
  },
  {
    title: "Get Out",
    genre: "Horror / Thriller",
    year: 2017,
    director: "Jordan Peele",
    description:
      "A young Black man visits his white girlfriend's family estate and uncovers a disturbing secret. A sharp social horror film that uses dread and dark comedy to explore racism and identity in modern America.",
  },
  {
    title: "Eternal Sunshine of the Spotless Mind",
    genre: "Romance / Sci-Fi",
    year: 2004,
    director: "Michel Gondry",
    description:
      "After a painful breakup, a couple undergoes a procedure to erase each other from their memories. A non-linear, deeply emotional exploration of love, memory, and what makes relationships worth keeping.",
  },
  {
    title: "Mad Max: Fury Road",
    genre: "Action / Sci-Fi",
    year: 2015,
    director: "George Miller",
    description:
      "In a post-apocalyptic wasteland, a woman rebels against a tyrannical ruler in a high-octane chase across the desert. An adrenaline-fueled masterpiece of visual storytelling with breathtaking practical stunts.",
  },
  {
    title: "Hereditary",
    genre: "Horror",
    year: 2018,
    director: "Ari Aster",
    description:
      "After the death of her secretive mother, a woman and her family unravel disturbing, terrifying secrets. A slow-burn psychological horror film rooted in grief, family trauma, and occult dread.",
  },
  {
    title: "Her",
    genre: "Romance / Sci-Fi",
    year: 2013,
    director: "Spike Jonze",
    description:
      "A lonely writer develops a deep emotional relationship with an AI operating system. A tender and melancholic meditation on loneliness, connection, and what it means to love in the digital age.",
  },
  {
    title: "Whiplash",
    genre: "Drama / Music",
    year: 2014,
    director: "Damien Chazelle",
    description:
      "A young jazz drummer pursues greatness under the brutal tutelage of a ruthless music conservatory instructor. An intense psychological duel about ambition, obsession, and the price of perfection.",
  },
  {
    title: "Arrival",
    genre: "Sci-Fi / Drama",
    year: 2016,
    director: "Denis Villeneuve",
    description:
      "A linguist is recruited to communicate with alien spacecraft that have landed around the world. A cerebral and emotional sci-fi film about language, time, loss, and what it means to be human.",
  },
  {
    title: "Oldboy",
    genre: "Thriller / Mystery",
    year: 2003,
    director: "Park Chan-wook",
    description:
      "A man is imprisoned without reason for 15 years, then suddenly released and given five days to find out why. A visceral, shocking Korean revenge thriller with one of cinema's most devastating twists.",
  },
];

async function seedMovie(client, movie, index, total) {
  const embedding = await embedDocument(movie.description);

  await client.query(
    `INSERT INTO movies (title, genre, year, director, description, embedding)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [movie.title, movie.genre, movie.year, movie.director, movie.description, JSON.stringify(embedding)]
  );

  console.log(`[seed] [${index + 1}/${total}] ${movie.title}`);
}

async function seed() {
  try {
    validateConfig();
    await setupDatabase();

    const client = await pool.connect();
    try {
      const { rowCount } = await client.query("SELECT 1 FROM movies LIMIT 1");

      if (rowCount > 0) {
        console.log("[seed] Clearing existing movies...");
        await client.query("DELETE FROM movies");
      }

      console.log(`[seed] Seeding ${MOVIES.length} movies...\n`);

      for (let i = 0; i < MOVIES.length; i++) {
        await seedMovie(client, MOVIES[i], i, MOVIES.length);
      }

      console.log(`\n[seed] Complete. Run: npm start`);
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("[seed] Failed:", err.message);
    process.exit(1);
  } finally {
    await shutdown();
  }
}

seed();

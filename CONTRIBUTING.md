# Contributing to Movie Recommender

First off, thanks for taking the time to contribute! 🎉

## How Can I Contribute?

### Reporting Bugs

- Use the GitHub issue tracker
- Describe the bug in detail
- Include steps to reproduce
- Include your environment details

### Suggesting Features

- Open an issue with the `enhancement` label
- Describe the feature and its use case
- Explain why it would be useful

### Pull Requests

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run linting (`npm run lint`)
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## Development Setup

```bash
# Clone your fork
git clone https://github.com/yourusername/movie-recommender.git
cd movie-recommender

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Start development
npm run dev
```

## Code Style

- Use ESLint and Prettier (already configured)
- Run `npm run lint` before committing
- Run `npm run format` to auto-format code

## Commit Messages

- Use present tense ("Add feature" not "Added feature")
- Use imperative mood ("Move cursor to..." not "Moves cursor to...")
- Keep first line under 72 characters

## Questions?

Feel free to open an issue with the `question` label.

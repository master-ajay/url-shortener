# URL Shortener

A simple and efficient URL shortener service built with Node.js and Express.

## Features

- **Shorten URLs:** Generate a unique short code for any long URL.
- **Redirection:** Redirect from the short code back to the original URL.
- **Environment Configuration:** Uses `dotenv` for managing environment-specific variables.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v14 or higher recommended)
- npm (comes with Node.js)

### Installation

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd url-shortener
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Configure Environment Variables:**
    Create a `.env` file in the root directory and add your configurations.
    ```bash
    PORT=3000
    # Add other variables like DATABASE_URL if applicable
    ```

### Running the Application

- **Development mode (with nodemon):**
  ```bash
  npm run dev
  ```

- **Production mode:**
  ```bash
  npm start
  ```

## API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/shorten` | Shortens a provided long URL. Expects `{ "url": "..." }` in the body. |
| `GET` | `/redirect/:code` | Redirects to the original URL associated with the given short code. |

## Project Structure

```
url-shortener/
├── src/
│   ├── config/       # Configuration files (env, database, etc.)
│   ├── controllers/  # Business logic for routes
│   ├── routes/       # API route definitions
│   ├── app.js        # Express app setup
│   └── server.js     # Server entry point
├── .env              # Environment variables (ignored by git)
├── .gitignore        # Git ignore rules
└── package.json      # Project dependencies and scripts
```

## License

This project is licensed under the ISC License. See the [package.json](package.json) file for details.

## Author

**Ajay**
